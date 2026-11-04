const Order = require('../models/Order');
const { delhiveryService, normalizeProvider, mapDelhiveryStatus } = require('../services');
const { updateOrderSignals, historyEntry } = require('../utils/orderStatusDeriver');
const { timingSafeEqualStr, createDelhiveryShipment } = require('../utils');
const { restockOrder, cancelOrder } = require('../services/orderService');
const { asyncHandler, httpError, toStr, isValidId, bestEffort } = require('../utils/http');
const { assertOwnerOrAdmin, isAdmin } = require('../middleware');

const PUSH_KEY = { IN_TRANSIT: 'shipped', OUT_FOR_DELIVERY: 'out_for_delivery', DELIVERED: 'delivered', RTO: 'cancelled' };

/**
 * Delhivery status webhook. Requires DELHIVERY_WEBHOOK_SECRET (rejects when unset).
 * Validates the transition BEFORE any side effect (restock), then applies it atomically.
 */
exports.delhiveryWebhook = async (req, res) => {
  const secret = process.env.DELHIVERY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ success: false, message: 'Webhook not configured' });

  let received = toStr(req.headers['x-delhivery-signature']) || toStr(req.headers.authorization);
  received = received.replace(/^(Bearer|Token)\s+/i, '');
  if (!received || !timingSafeEqualStr(received, secret)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const body = req.body || {};
    const shipment = body.Shipment || {};
    const waybill = toStr(body.waybill || shipment.AWB);
    const rawStatus = toStr(body.current_status || body.status || shipment.Status?.Status);
    if (!waybill) return res.status(400).json({ success: false, message: 'Waybill required' });

    const order = await Order.findOne({ waybill });
    if (!order) return res.json({ received: true, message: 'Order not found' });
    if (normalizeProvider(order.deliveryProvider) === 'SELF') return res.json({ received: true, ignored: 'Self delivery order' });

    const next = mapDelhiveryStatus(rawStatus);
    if (!next || next === order.deliveryStatus) return res.json({ received: true, unchanged: true });

    if (next === 'PRE_PICKUP_CANCEL') {
      await cancelOrder(order._id, { reason: 'Cancelled by courier before pickup', refund: 'none' });
      return res.json({ received: true, orderId: order._id });
    }

    // Throws 409 on an invalid transition — nothing has been changed yet.
    const fields = updateOrderSignals(order, { deliveryStatus: next }, { source: 'WEBHOOK' });
    const set = { ...fields };
    if (next === 'RTO') {
      set.rtoHandled = true;
      set.rtoCharges = (order.shipping?.total || 0) * 2;
      set.logisticsLoss = set.rtoCharges;
    }
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, deliveryStatus: order.deliveryStatus },
      { $set: set, $push: { statusHistory: historyEntry({ ...order.toObject(), ...set }, { note: `Delhivery: ${rawStatus}` }) } },
      { new: true }
    );
    if (!updated) return res.json({ received: true, message: 'Concurrent update — ignored' });

    if (next === 'RTO') await restockOrder(order._id); // exactly once (stockRestored gate)
    if (PUSH_KEY[next]) {
      await bestEffort(() => require('../services/push').notifyOrderUpdate(updated, PUSH_KEY[next]), 3000, 'delhivery push');
    }
    const mailKind = { OUT_FOR_DELIVERY: 'out_for_delivery', DELIVERED: 'delivered' }[next];
    if (mailKind) await bestEffort(() => require('../services/mailer').sendOrderEmail(updated._id, mailKind), 6000, 'delhivery email');
    res.json({ received: true, orderId: order._id });
  } catch (error) {
    console.error('Delhivery webhook error:', error.message);
    // 200 so Delhivery doesn't retry a permanently invalid update forever.
    res.status(200).json({ success: false, message: error.status && error.status < 500 ? error.message : 'Processing error' });
  }
};

exports.checkPincode = asyncHandler(async (req, res) => {
  const result = await delhiveryService.checkPincode(toStr(req.params.pincode));
  if (!result.success) throw httpError(400, result.error || 'Pincode check failed');
  res.json({ success: true, serviceable: result.serviceable, city: result.city, state: result.state });
});

exports.calculateRate = asyncHandler(async (req, res) => {
  const weight = Number(toStr(req.body?.weight));
  const result = await delhiveryService.calculateRate({
    pickupPincode: process.env.DELHIVERY_PICKUP_PIN,
    deliveryPincode: toStr(req.body?.deliveryPincode),
    weight,
  });
  if (!result.success) throw httpError(400, result.error || 'Rate calculation failed');
  res.json({ success: true, rate: result.rate, currency: result.currency, breakdown: result.breakdown });
});

// Admin: create the shipment manually (same builder as the automatic path).
exports.createShipment = asyncHandler(async (req, res) => {
  const orderId = toStr(req.body?.orderId);
  if (!isValidId(orderId)) throw httpError(400, 'Order ID required');
  const order = await Order.findById(orderId);
  if (!order) throw httpError(404, 'Order not found');
  if (order.paymentStatus !== 'paid') throw httpError(409, 'Cannot create shipment for unpaid order');
  if (order.status !== 'confirmed') throw httpError(409, 'Order must be confirmed before shipment creation');
  if (normalizeProvider(order.deliveryProvider) !== 'DELHIVERY') throw httpError(409, 'Shipment creation only for DELHIVERY orders');
  if (order.waybill) throw httpError(409, 'Shipment already created', { waybill: order.waybill });
  if ((order.shipmentAttempts || 0) >= 3) throw httpError(409, 'Maximum shipment attempts exceeded');

  let result;
  try {
    result = await createDelhiveryShipment(order._id);
  } catch (e) {
    throw httpError(502, `Shipment creation failed: ${e.message}`);
  }
  res.json({ success: true, waybill: result.waybill, status: result.status || 'SHIPMENT_CREATED', estimatedDelivery: result.estimatedDelivery });
});

// Owner/admin: tracking for an order.
exports.trackOrder = asyncHandler(async (req, res) => {
  const orderId = toStr(req.params.orderId);
  if (!isValidId(orderId)) throw httpError(400, 'Invalid order id');
  const order = await Order.findById(orderId).select('waybill deliveryStatus status userId');
  if (!order) throw httpError(404, 'Order not found');
  assertOwnerOrAdmin(req, order.userId);

  if (!order.waybill) {
    return res.json({ success: true, status: order.deliveryStatus, message: 'Shipment not yet created' });
  }
  const trackingResult = await delhiveryService.trackShipment(order.waybill);
  res.json({
    success: true,
    orderId,
    waybill: order.waybill,
    orderStatus: order.status,
    deliveryStatus: order.deliveryStatus,
    tracking: trackingResult.success ? trackingResult : null,
  });
});

// Track by waybill (owner of the matching order, or admin).
exports.trackShipment = asyncHandler(async (req, res) => {
  const waybill = toStr(req.params.waybill);
  if (!waybill) throw httpError(400, 'Waybill required');
  if (!isAdmin(req)) {
    const order = await Order.findOne({ waybill }).select('userId');
    if (!order) throw httpError(404, 'Shipment not found');
    assertOwnerOrAdmin(req, order.userId);
  }
  const result = await delhiveryService.trackShipment(waybill);
  if (!result.success) throw httpError(400, result.error || 'Tracking failed');
  res.json({
    success: true,
    waybill,
    status: result.status,
    location: result.location,
    expectedDelivery: result.expectedDelivery,
    currentLocation: result.currentLocation,
    trackingHistory: result.trackingHistory,
  });
});
