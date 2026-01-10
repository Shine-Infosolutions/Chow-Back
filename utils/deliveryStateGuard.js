/**
 * DELIVERY STATE TRANSITION GUARD
 * Prevents invalid state transitions
 */

const DELIVERY_TRANSITIONS = {
  PENDING: ['SHIPMENT_CREATED'],
  SHIPMENT_CREATED: ['IN_TRANSIT', 'RTO'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERED', 'RTO'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RTO'],
  DELIVERED: [], // Terminal state
  RTO: [], // Terminal state
  UNKNOWN: ['PENDING', 'SHIPMENT_CREATED'] // Recovery states
};

const validateDeliveryTransition = (currentStatus, newStatus) => {
  if (!currentStatus) return { valid: true }; // First status
  
  const allowedNext = DELIVERY_TRANSITIONS[currentStatus] || [];
  const valid = allowedNext.includes(newStatus);
  
  return {
    valid,
    error: valid ? null : `Invalid transition: ${currentStatus} → ${newStatus}`
  };
};

const canAdminUpdate = (order) => {
  return {
    deliveryStatus: order.deliveryProvider === 'SELF',
    orderStatus: true, // Admin can always update order status
    reason: order.deliveryProvider === 'DELHIVERY' 
      ? 'Delhivery delivery status is webhook-controlled'
      : null
  };
};

module.exports = {
  validateDeliveryTransition,
  canAdminUpdate,
  DELIVERY_TRANSITIONS
};