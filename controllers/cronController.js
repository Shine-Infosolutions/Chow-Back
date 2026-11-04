const Order = require('../models/Order');
const { razorpay } = require('../config');
const { confirmPayment, appendNote } = require('../services/orderService');
const { timingSafeEqualStr } = require('../utils');
const { asyncHandler, httpError, toStr } = require('../utils/http');

// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically when CRON_SECRET is set.
const requireCronSecret = (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw httpError(503, 'Cron is not configured');
  const header = toStr(req.headers.authorization);
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqualStr(token, secret)) throw httpError(401, 'Unauthorized');
};

/**
 * GET /api/cron/reconcile — catch payments whose verify call and webhook were both missed.
 * Unpaid orders (pending | failed | cancelled) from the last 48h with a Razorpay order id:
 * if Razorpay has a captured payment with the right amount, confirm via the shared confirmPayment
 * (which auto-refunds when the order had been cancelled).
 */
exports.reconcilePayments = asyncHandler(async (req, res) => {
  requireCronSecret(req);
  if (!razorpay) throw httpError(503, 'Payment gateway is not configured');

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const orders = await Order.find({
    paymentStatus: { $in: ['pending', 'failed', 'cancelled'] },
    createdAt: { $gte: since },
    'razorpayData.orderId': { $exists: true, $ne: null },
  }).select('_id totalAmount razorpayData adminNotes').limit(200);

  const result = { checked: orders.length, confirmed: 0, refunded: 0, mismatched: 0, errors: 0 };
  for (const order of orders) {
    const rzpOrderIds = [...new Set(order.razorpayData.map((r) => r.orderId).filter(Boolean))];
    try {
      for (const rzpOrderId of rzpOrderIds) {
        const resp = await razorpay.orders.fetchPayments(rzpOrderId);
        const captured = (resp?.items || []).find((p) => p.status === 'captured');
        if (!captured) continue;
        if (Number(captured.amount) !== Math.round(order.totalAmount * 100)) {
          result.mismatched += 1;
          await Order.updateOne({ _id: order._id }, {
            $set: { adminNotes: appendNote(order.adminNotes, `RECONCILE: captured ${captured.amount} paise ≠ expected ${Math.round(order.totalAmount * 100)}`) },
          });
          break;
        }
        const r = await confirmPayment(order._id, { ...captured, order_id: rzpOrderId }, { source: 'reconcile' });
        if (r.autoRefunded) result.refunded += 1;
        else if (!r.alreadyPaid) result.confirmed += 1;
        break;
      }
    } catch (e) {
      result.errors += 1;
      console.error(`[reconcile] order ${order._id}:`, e?.error?.description || e.message);
    }
  }
  res.json({ success: true, ...result });
});
