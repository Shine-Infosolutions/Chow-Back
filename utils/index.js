const crypto = require("crypto");
const { delhiveryService, deliveryService } = require('../services');
const { bestEffort } = require('./http');

// ==================== SIGNATURE UTILITIES ====================

// Constant-time comparison of two hex strings (false on any length/format mismatch).
const timingSafeEqualHex = (expectedHex, receivedHex) => {
  if (typeof expectedHex !== 'string' || typeof receivedHex !== 'string') return false;
  if (!/^[0-9a-f]+$/i.test(receivedHex) || expectedHex.length !== receivedHex.length) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(receivedHex.toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Constant-time comparison of arbitrary strings (e.g. shared secrets).
const timingSafeEqualStr = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
};

const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

// Razorpay checkout signature: HMAC_SHA256(order_id|payment_id, key_secret)
const verifyRazorpaySignature = (orderId, paymentId, signature) => {
  if (!process.env.RAZORPAY_SECRET || !orderId || !paymentId) return false;
  return timingSafeEqualHex(hmacHex(process.env.RAZORPAY_SECRET, `${orderId}|${paymentId}`), signature);
};

// Razorpay webhook signature over the RAW request body.
const verifyWebhookSignature = (rawBody, signature, secret) => {
  if (!secret || !rawBody) return false;
  return timingSafeEqualHex(hmacHex(secret, rawBody), signature);
};

// ==================== INVOICE TOKEN ====================

// invoiceToken = HMAC-SHA256(orderId, INVOICE_SECRET || JWT_SECRET) hex, first 32 chars.
const invoiceTokenFor = (orderId) => {
  const secret = process.env.INVOICE_SECRET || process.env.JWT_SECRET;
  if (!secret || !orderId) return null;
  return hmacHex(secret, String(orderId)).slice(0, 32);
};
const verifyInvoiceToken = (orderId, token) => {
  const expected = invoiceTokenFor(orderId);
  return Boolean(expected) && timingSafeEqualHex(expected, typeof token === 'string' ? token : '');
};

// ==================== SHIPMENT UTILITIES ====================

// Resolve the delivery address: snapshot first, then the user's saved address (old orders).
const resolveDeliveryAddress = (order) => {
  const snap = order.shippingAddress;
  if (snap && (snap.street || snap.postcode)) return snap;
  const list = order.userId?.address || [];
  return list.find((a) => String(a._id) === String(order.addressId)) || null;
};

// THE Delhivery shipment payload builder (both the auto and manual paths use it).
const buildShipmentData = (order) => {
  const addr = resolveDeliveryAddress(order);
  if (!addr) throw new Error('Delivery address not found');
  return {
    orderId: order._id,
    customerName: `${addr.firstName || ''} ${addr.lastName || ''}`.trim() || order.userId?.name || '',
    address: [addr.street, addr.apartment].filter(Boolean).join(', '),
    city: addr.city || '',
    state: addr.state || '',
    pincode: addr.postcode || order.deliveryPincode || '',
    phone: order.contactPhone || addr.phone || order.userId?.phone || '',
    paymentMode: 'PREPAID',
    totalAmount: order.totalAmount || 0, // rupees
    totalWeight: order.totalWeight || 500,
    totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    itemsDescription: order.items.map((item) => `${item.itemId?.name || item.name || 'Item'} x ${item.quantity}`).join(', ')
  };
};

/**
 * Create the Delhivery shipment for a paid, confirmed DELHIVERY order.
 * Sets waybill + shipmentCreated:true + deliveryStatus SHIPMENT_CREATED (status → shipped).
 * Returns the service result; throws on failure (after recording the attempt).
 */
const createDelhiveryShipment = async (orderId) => {
  const Order = require('../models/Order');
  const { updateOrderSignals } = require('./orderStatusDeriver');
  try {
    const order = await Order.findById(orderId)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name weight');

    if (!order) throw new Error('Order not found');
    if (order.waybill) return { success: true, waybill: order.waybill, alreadyCreated: true };
    if (!deliveryService.shouldCreateDelhiveryShipment(order)) {
      throw new Error('Order is not eligible for a Delhivery shipment');
    }

    const result = await delhiveryService.createShipment(buildShipmentData(order));
    if (!result?.success) throw new Error(result?.error || 'Shipment creation failed');

    const fields = updateOrderSignals(order, { deliveryStatus: 'SHIPMENT_CREATED' }, { source: 'SYSTEM' });
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, $or: [{ waybill: null }, { waybill: '' }] },
      {
        $set: {
          ...fields,
          waybill: result.waybill,
          shipmentCreated: true,
          shipmentLastError: null,
          'shipping.charged': true
        },
        $push: { statusHistory: { status: fields.status, deliveryStatus: 'SHIPMENT_CREATED', paymentStatus: order.paymentStatus, at: new Date(), note: `Delhivery shipment created (${result.waybill})` } },
        $inc: { shipmentAttempts: 1 }
      },
      { new: true }
    ).populate('userId', 'name');

    if (updated) {
      await bestEffort(() => require('../services/push').notifyOrderUpdate(updated, 'shipped'), 3000, 'shipped push');
    }
    return result;
  } catch (error) {
    console.error(`Shipment creation failed for order ${orderId}:`, error.message);
    await Order.updateOne(
      { _id: orderId },
      { $inc: { shipmentAttempts: 1 }, $set: { shipmentLastError: error.message } }
    ).catch(() => {});
    throw error;
  }
};

module.exports = {
  timingSafeEqualHex,
  timingSafeEqualStr,
  verifyRazorpaySignature,
  verifyWebhookSignature,
  invoiceTokenFor,
  verifyInvoiceToken,
  resolveDeliveryAddress,
  buildShipmentData,
  createDelhiveryShipment
};
