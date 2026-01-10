/**
 * SINGLE SOURCE OF TRUTH for order status
 * Status is NEVER set directly - only derived from signals
 * 
 * CASING RULE (INTENTIONAL):
 * - deliveryStatus: UPPERCASE (matches external APIs)
 * - paymentStatus: lowercase (internal consistency)
 * - status: lowercase (UI/API consistency)
 */

// THE delivery state machine - this is the only one
const DELIVERY_TRANSITIONS = {
  PENDING: ['SHIPMENT_CREATED', 'OUT_FOR_DELIVERY', 'PRE_PICKUP_CANCEL'],
  SHIPMENT_CREATED: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RTO', 'PRE_PICKUP_CANCEL'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERED', 'RTO'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RTO', 'PRE_PICKUP_CANCEL', 'PENDING'], // Allow admin corrections
  DELIVERED: ['OUT_FOR_DELIVERY', 'PRE_PICKUP_CANCEL', 'PENDING'], // Allow admin corrections
  RTO: ['PRE_PICKUP_CANCEL'], // Allow admin cancel after RTO
  PRE_PICKUP_CANCEL: [], // Terminal
  null: ['PENDING'], // Only allow proper initialization
  undefined: ['PENDING']
};

const validateDeliveryTransition = (currentStatus, newStatus) => {
  if (!currentStatus || currentStatus === null || currentStatus === undefined) {
    return { valid: true };
  }
  
  const allowedNext = DELIVERY_TRANSITIONS[currentStatus] || [];
  const valid = allowedNext.includes(newStatus);
  
  return {
    valid,
    error: valid ? null : `Invalid transition: ${currentStatus} → ${newStatus}`
  };
};

/**
 * THE status derivation function - this is the only one
 * Status represents PRIMARY order lifecycle, not financial resolution
 */
const deriveOrderStatus = (order) => {
  const { deliveryStatus, paymentStatus } = order;
  
  // Cancelled orders
  if (deliveryStatus === 'PRE_PICKUP_CANCEL') {
    return 'cancelled';
  }
  
  // Delivered orders - check payment resolution
  if (deliveryStatus === 'DELIVERED') {
    return paymentStatus === 'paid' ? 'delivered' : 'delivered';
  }
  
  // RTO = cancelled (customer didn't receive)
  if (deliveryStatus === 'RTO') {
    return 'cancelled';
  }
  
  // In-transit scenarios
  if (['OUT_FOR_DELIVERY', 'IN_TRANSIT'].includes(deliveryStatus)) {
    return 'shipped';
  }
  
  // Payment failed
  if (paymentStatus === 'failed') {
    return 'failed';
  }
  
  // Confirmed orders
  if (paymentStatus === 'paid') {
    return 'confirmed';
  }
  
  return 'pending';
};

/**
 * THE permission gate - this is the only one
 */
const getUpdatePermissions = (deliveryProvider, source = 'ADMIN') => {
  if (source === 'WEBHOOK') {
    return {
      canUpdateDeliveryStatus: true,
      canUpdatePaymentStatus: false,
      canCancel: false
    };
  }
  
  if (deliveryProvider === 'DELHIVERY') {
    return {
      canUpdateDeliveryStatus: false, // webhook only
      canUpdatePaymentStatus: true,
      canCancel: true
    };
  }
  
  if (deliveryProvider === 'SELF') {
    return {
      canUpdateDeliveryStatus: true,
      canUpdatePaymentStatus: true,
      canCancel: true
    };
  }
  
  return { canUpdateDeliveryStatus: false, canUpdatePaymentStatus: false, canCancel: false };
};

/**
 * Enforce business invariants - prevent impossible combinations
 */
const validateInvariants = (orderData, updateFields) => {
  const finalOrder = { ...orderData, ...updateFields };
  
  // DELIVERED orders must have been shipped
  if (finalOrder.deliveryStatus === 'DELIVERED' && finalOrder.deliveryProvider === 'DELHIVERY' && !finalOrder.shipmentCreated) {
    throw new Error('DELIVERED order must have shipmentCreated=true');
  }
  
  // SELF delivery orders never have waybill
  if (finalOrder.deliveryProvider === 'SELF' && finalOrder.waybill) {
    throw new Error('SELF delivery orders cannot have waybill');
  }
  
  // RTO only valid for shipped orders - check REQUESTED transition
  if (updateFields.deliveryStatus === 'RTO' && !['SHIPMENT_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(orderData.deliveryStatus)) {
    throw new Error('RTO only valid for shipped orders');
  }
};

/**
 * THE update function - this is the only one
 */
const updateOrderSignals = (order, updates, options = {}) => {
  const { source = 'ADMIN' } = options;
  const permissions = getUpdatePermissions(order.deliveryProvider, source);
  
  const orderData = order.toObject ? order.toObject() : order;
  const updateFields = {};
  
  // Idempotency guard - ignore same-status updates
  if (updates.deliveryStatus && updates.deliveryStatus === orderData.deliveryStatus) {
    delete updates.deliveryStatus;
  }
  if (updates.paymentStatus && updates.paymentStatus === orderData.paymentStatus) {
    delete updates.paymentStatus;
  }
  
  // If no changes after idempotency check, return empty
  if (!updates.deliveryStatus && !updates.paymentStatus) {
    return {};
  }
  
  // Validate delivery status update
  if (updates.deliveryStatus) {
    if (!permissions.canUpdateDeliveryStatus) {
      throw new Error(`${source} cannot update deliveryStatus for ${order.deliveryProvider} orders`);
    }
    
    const transition = validateDeliveryTransition(orderData.deliveryStatus, updates.deliveryStatus);
    if (!transition.valid) {
      throw new Error(transition.error);
    }
    
    updateFields.deliveryStatus = updates.deliveryStatus;
  }
  
  // Validate payment status update
  if (updates.paymentStatus) {
    if (!permissions.canUpdatePaymentStatus) {
      throw new Error(`${source} cannot update paymentStatus for ${order.deliveryProvider} orders`);
    }
    updateFields.paymentStatus = updates.paymentStatus;
  }
  
  // 1️⃣ ENFORCE INVARIANTS FIRST (before derivation)
  validateInvariants(orderData, updateFields);
  
  // 2️⃣ THEN derive status
  const updatedOrderData = { ...orderData, ...updateFields };
  updateFields.status = deriveOrderStatus(updatedOrderData);
  
  return updateFields;
};

module.exports = {
  deriveOrderStatus,
  updateOrderSignals,
  getUpdatePermissions,
  validateDeliveryTransition,
  DELIVERY_TRANSITIONS
};