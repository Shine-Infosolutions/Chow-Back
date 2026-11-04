/**
 * SINGLE SOURCE OF TRUTH for order status.
 * `status` is derived from the delivery + payment signals; delivery changes go through
 * `updateOrderSignals`, which enforces the delivery state machine.
 *
 * CASING RULE (INTENTIONAL):
 * - deliveryStatus: UPPERCASE (matches external APIs)
 * - paymentStatus / status: lowercase
 *
 * Errors: invalid transitions / invariant violations → 409, permission problems → 403.
 */
const { httpError } = require('./http');
const { normalizeProvider } = require('../services');

// THE delivery state machine.
const DELIVERY_TRANSITIONS = {
  PENDING: ['SHIPMENT_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PRE_PICKUP_CANCEL'],
  SHIPMENT_CREATED: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RTO', 'PRE_PICKUP_CANCEL'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERED', 'RTO'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RTO', 'PRE_PICKUP_CANCEL'],
  DELIVERED: [], // terminal — use a refund for post-delivery issues
  RTO: ['PRE_PICKUP_CANCEL'],
  PRE_PICKUP_CANCEL: [] // terminal
};

const validateDeliveryTransition = (currentStatus, newStatus) => {
  if (!currentStatus) return { valid: newStatus === 'PENDING' || Boolean(DELIVERY_TRANSITIONS.PENDING.includes(newStatus)) };
  const valid = (DELIVERY_TRANSITIONS[currentStatus] || []).includes(newStatus);
  return { valid, error: valid ? null : `Invalid transition: ${currentStatus} → ${newStatus}` };
};

const deriveOrderStatus = ({ deliveryStatus, paymentStatus }) => {
  if (deliveryStatus === 'PRE_PICKUP_CANCEL' || deliveryStatus === 'RTO') return 'cancelled';
  if (deliveryStatus === 'DELIVERED') return 'delivered';
  if (['OUT_FOR_DELIVERY', 'IN_TRANSIT', 'SHIPMENT_CREATED'].includes(deliveryStatus)) {
    return paymentStatus === 'paid' ? 'shipped' : 'pending';
  }
  return paymentStatus === 'paid' ? 'confirmed' : 'pending';
};

const getUpdatePermissions = (deliveryProvider, source = 'ADMIN') => {
  const provider = normalizeProvider(deliveryProvider);
  if (source === 'WEBHOOK' || source === 'SYSTEM') {
    return { canUpdateDeliveryStatus: true, canUpdatePaymentStatus: false, canCancel: true };
  }
  if (provider === 'DELHIVERY') {
    return { canUpdateDeliveryStatus: false, canUpdatePaymentStatus: true, canCancel: true };
  }
  if (provider === 'SELF') {
    return { canUpdateDeliveryStatus: true, canUpdatePaymentStatus: true, canCancel: true };
  }
  return { canUpdateDeliveryStatus: false, canUpdatePaymentStatus: false, canCancel: false };
};

// Enforce business invariants — prevent impossible combinations.
const validateInvariants = (orderData, updateFields) => {
  const finalOrder = { ...orderData, ...updateFields };
  const provider = normalizeProvider(finalOrder.deliveryProvider);

  if (finalOrder.deliveryStatus === 'DELIVERED' && provider === 'DELHIVERY' && !finalOrder.shipmentCreated) {
    throw httpError(409, 'A Delhivery order can only be delivered after its shipment is created');
  }
  if (provider === 'SELF' && finalOrder.waybill) {
    throw httpError(409, 'Self-delivery orders cannot have a waybill');
  }
  if (updateFields.deliveryStatus === 'RTO' && !['SHIPMENT_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(orderData.deliveryStatus)) {
    throw httpError(409, 'RTO is only valid for shipped orders');
  }
  // Goods only move for paid orders.
  if (['SHIPMENT_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(updateFields.deliveryStatus) && finalOrder.paymentStatus !== 'paid') {
    throw httpError(409, 'Order is not paid');
  }
};

/**
 * Validate a deliveryStatus change and return the fields to $set (deliveryStatus, status,
 * deliveredAt). Returns {} for a no-op. Throws 403/409.
 * Cancellation (PRE_PICKUP_CANCEL) should go through the cancel helper so stock/refunds are handled.
 */
const updateOrderSignals = (order, updates, options = {}) => {
  const { source = 'ADMIN' } = options;
  const permissions = getUpdatePermissions(order.deliveryProvider, source);
  const orderData = order.toObject ? order.toObject() : order;
  const updateFields = {};

  const next = updates.deliveryStatus;
  if (!next || next === orderData.deliveryStatus) return {};

  if (!permissions.canUpdateDeliveryStatus) {
    throw httpError(403, `Delivery status of ${orderData.deliveryProvider} orders is updated by the courier only`);
  }
  const transition = validateDeliveryTransition(orderData.deliveryStatus, next);
  if (!transition.valid) throw httpError(409, transition.error);

  updateFields.deliveryStatus = next;
  validateInvariants(orderData, updateFields);

  updateFields.status = deriveOrderStatus({ ...orderData, ...updateFields });
  const now = new Date();
  if (['SHIPMENT_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(next) && !orderData.shippedAt) updateFields.shippedAt = now;
  if (next === 'OUT_FOR_DELIVERY' && !orderData.outForDeliveryAt) updateFields.outForDeliveryAt = now;
  if (next === 'DELIVERED') updateFields.deliveredAt = now;
  if (['PRE_PICKUP_CANCEL', 'RTO'].includes(next)) updateFields.cancelledAt = now;
  return updateFields;
};

// One statusHistory entry describing the resulting state.
const historyEntry = (state, { by, note } = {}) => ({
  status: state.status,
  deliveryStatus: state.deliveryStatus,
  paymentStatus: state.paymentStatus,
  at: new Date(),
  ...(by ? { by } : {}),
  ...(note ? { note: String(note).slice(0, 300) } : {})
});

module.exports = {
  historyEntry,
  deriveOrderStatus,
  updateOrderSignals,
  getUpdatePermissions,
  validateDeliveryTransition,
  DELIVERY_TRANSITIONS
};
