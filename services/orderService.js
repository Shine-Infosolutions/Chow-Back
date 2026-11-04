/**
 * Order money/stock state transitions shared by the payment controller, the Razorpay
 * webhook and the admin order endpoints:
 *   - confirmPayment   (atomic "first one wins" gate; stock decrement; paid notifications)
 *   - refundOrder      (partial/full, razorpay|manual; reserves the amount atomically)
 *   - restockOrder     (exactly once)
 *   - cancelOrder      (state machine + restock + refund)
 *   - applyRefundWebhook
 */
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Item = require('../models/Item');
const { razorpay } = require('../config');
const { httpError, round2, bestEffort } = require('../utils/http');
const { validateDeliveryTransition, historyEntry } = require('../utils/orderStatusDeriver');
const { deliveryService } = require('./index');
const { assignInvoiceNumber, assignCreditNotes } = require('./invoiceNumbers');

const EPS = 0.005;

// Storefront rule: discountPrice applies only when 0 < discountPrice < price.
const unitPriceOf = (item) => {
  const price = Number(item.price) || 0;
  const discount = Number(item.discountPrice) || 0;
  return discount > 0 && discount < price ? discount : price;
};

const appendNote = (existing, line) => {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return [existing, `[${stamp}] ${line}`].filter(Boolean).join('\n');
};

/* --------------------------------- Stock --------------------------------- */

// Decrement stock for each order line without ever going negative.
// Returns [{ index, deducted, shortfall, name }].
const decrementStock = async (order) => {
  const results = [];
  for (let i = 0; i < order.items.length; i++) {
    const line = order.items[i];
    const qty = line.quantity;
    let deducted = 0;
    const full = await Item.findOneAndUpdate(
      { _id: line.itemId, stockQty: { $gte: qty } },
      { $inc: { stockQty: -qty } },
      { new: false, projection: { _id: 1 } }
    );
    if (full) {
      deducted = qty;
    } else {
      // Not enough: take what is left (atomically clamp at 0) and record the shortfall.
      const prev = await Item.findOneAndUpdate(
        { _id: line.itemId, stockQty: { $gt: 0 } },
        [{ $set: { stockQty: { $max: [0, { $subtract: ['$stockQty', qty] }] } } }],
        { new: false, projection: { stockQty: 1 } }
      );
      deducted = prev ? Math.min(qty, Math.max(0, prev.stockQty)) : 0;
    }
    results.push({ index: i, deducted, shortfall: qty - deducted, name: line.name || String(line.itemId) });
  }
  return results;
};

// Put an order's deducted stock back exactly once (paid orders only). Returns true if restocked.
const restockOrder = async (orderId) => {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, paymentStatus: 'paid', stockRestored: { $ne: true } },
    { $set: { stockRestored: true } },
    { new: true }
  );
  if (!order) return false;
  await Promise.all(
    order.items.map((line) => {
      const qty = line.stockDeducted != null ? line.stockDeducted : line.quantity; // legacy orders: full qty
      return qty > 0 ? Item.updateOne({ _id: line.itemId }, { $inc: { stockQty: qty } }) : null;
    })
  );
  return true;
};

/* ----------------------------- Notifications ----------------------------- */

// Only ever called for PAID orders: confirmation email, customer push, admin "new order" push.
const sendPaidNotifications = async (orderId) => {
  const { sendOrderConfirmationEmail } = require('./mailer');
  const push = require('./push');
  const populated = await Order.findById(orderId).populate('userId', 'name');
  await Promise.all([
    bestEffort(() => sendOrderConfirmationEmail(orderId), 6000, 'confirmation email'),
    populated ? bestEffort(() => push.notifyNewOrder(populated), 3000, 'admin push') : null,
    populated ? bestEffort(() => push.notifyOrderUpdate(populated, 'confirmed'), 3000, 'customer push') : null,
  ]);
};

const sendRefundEmail = (orderId, amount, mode, arn) =>
  bestEffort(async () => {
    const o = await Order.findById(orderId).select('refundedAmount');
    return require('./mailer').sendOrderEmail(orderId, 'refund', { amount, mode, arn, totalRefunded: o?.refundedAmount });
  }, 6000, 'refund email');

/* ------------------------------ Refund state ----------------------------- */

const computeRefundState = (order) => {
  const refunds = order.refunds || [];
  if (!refunds.length) {
    return { refundedAmount: round2(order.refundedAmount || 0), refundStatus: order.refundStatus || 'none' };
  }
  const committed = refunds.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amount, 0);
  const processed = refunds.filter((r) => r.status === 'processed').reduce((s, r) => s + r.amount, 0);
  let refundStatus;
  if (refunds.some((r) => r.status === 'pending')) refundStatus = 'pending';
  else if (processed > 0 && processed >= order.totalAmount - EPS) refundStatus = 'processed';
  else if (processed > 0) refundStatus = 'partial';
  else refundStatus = refunds.some((r) => r.status === 'failed') ? 'failed' : 'none';
  return { refundedAmount: round2(committed), refundStatus };
};

const refundableAmountOf = (order) => {
  if (order.paymentStatus !== 'paid') return 0;
  // Legacy orders marked refunded before the refunds[] ledger existed.
  if (!(order.refunds || []).length && order.refundStatus === 'processed') return 0;
  return Math.max(0, round2(order.totalAmount - (order.refundedAmount || 0)));
};

const syncRefundState = async (orderId) => {
  await assignCreditNotes(orderId); // processed refunds get credit-note numbers
  const order = await Order.findById(orderId);
  if (!order) return null;
  const state = computeRefundState(order);
  if (state.refundStatus !== order.refundStatus || state.refundedAmount !== order.refundedAmount) {
    await Order.updateOne({ _id: orderId }, { $set: state });
    Object.assign(order, state);
  }
  return order;
};

// The captured Razorpay payment id for an order (latest one).
const capturedPaymentId = (order) =>
  [...(order.razorpayData || [])].reverse().find((p) => p.paymentId && ['paid', 'captured'].includes(p.status))?.paymentId || null;

/**
 * Refund a paid order.
 * opts: { amount?, reason, mode:'razorpay'|'manual', restock?, by?, tolerateGatewayFailure? }
 * Returns the fresh order document. Throws 400/409/502.
 */
const refundOrder = async (orderId, opts = {}) => {
  const mode = opts.mode === 'manual' ? 'manual' : 'razorpay';
  const order = await Order.findById(orderId);
  if (!order) throw httpError(404, 'Order not found');
  if (order.paymentStatus !== 'paid') throw httpError(409, 'Only paid orders can be refunded');

  const refundable = refundableAmountOf(order);
  const amount = opts.amount == null || opts.amount === '' ? refundable : round2(opts.amount);
  if (!(amount > 0)) throw httpError(400, refundable > 0 ? 'Refund amount must be greater than 0' : 'Nothing left to refund');
  if (amount > refundable + EPS) throw httpError(400, `Refund amount exceeds the refundable amount (₹${refundable})`);

  let paymentId = null;
  if (mode === 'razorpay') {
    paymentId = capturedPaymentId(order);
    if (!paymentId) throw httpError(409, 'No captured Razorpay payment found for this order — use a manual refund');
    if (!razorpay) throw httpError(503, 'Payment gateway is not configured');
  }

  // Atomically reserve the amount (prevents two concurrent refunds exceeding the total).
  const refundId = new mongoose.Types.ObjectId();
  const reserved = await Order.findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: 'paid',
      $expr: { $lte: [{ $add: [{ $ifNull: ['$refundedAmount', 0] }, amount] }, { $add: ['$totalAmount', EPS] }] }
    },
    {
      $push: {
        refunds: {
          _id: refundId,
          amount,
          reason: opts.reason || '',
          mode,
          status: mode === 'manual' ? 'processed' : 'pending',
          createdAt: new Date(),
          by: opts.by || undefined
        }
      },
      $inc: { refundedAmount: amount }
    },
    { new: true }
  );
  if (!reserved) throw httpError(409, 'Refund conflicts with another refund in progress; reload and retry');
  await Order.updateOne({ _id: order._id }, {
    $push: { statusHistory: historyEntry(reserved, { by: opts.by, note: `Refund ₹${amount} (${mode}) ${mode === 'manual' ? 'recorded' : 'initiated'}${opts.reason ? `: ${opts.reason}` : ''}` }) }
  });
  let processedNow = mode === 'manual';
  let arn;

  if (mode === 'razorpay') {
    try {
      const rp = await razorpay.payments.refund(paymentId, {
        amount: Math.round(amount * 100),
        speed: 'normal',
        notes: { orderId: String(order._id), reason: String(opts.reason || '').slice(0, 250) }
      });
      // Don't overwrite a status the refund webhook may already have written.
      arn = rp.acquirer_data?.arn || undefined;
      await Order.updateOne(
        { _id: order._id, 'refunds._id': refundId },
        { $set: { 'refunds.$.razorpayRefundId': rp.id, ...(arn ? { 'refunds.$.arn': arn } : {}) } }
      );
      if (rp.status === 'processed') {
        const r = await Order.updateOne(
          { _id: order._id, refunds: { $elemMatch: { _id: refundId, status: 'pending' } } },
          { $set: { 'refunds.$.status': 'processed' } }
        );
        processedNow = r.modifiedCount === 1;
      }
    } catch (e) {
      const msg = e?.error?.description || e?.message || 'Refund failed';
      await Order.updateOne(
        { _id: order._id, 'refunds._id': refundId },
        {
          $set: { 'refunds.$.status': 'failed', 'refunds.$.error': msg },
          $inc: { refundedAmount: -amount },
          $push: { statusHistory: historyEntry(reserved, { by: opts.by, note: `Refund ₹${amount} failed: ${msg}` }) }
        }
      );
      await syncRefundState(order._id);
      if (!opts.tolerateGatewayFailure) throw httpError(502, `Razorpay refund failed: ${msg}`);
    }
  }

  if (opts.restock) await restockOrder(order._id);
  const synced = await syncRefundState(order._id);
  if (processedNow && !opts.skipEmail) await sendRefundEmail(order._id, amount, mode, arn);
  return synced;
};

/* ---------------------------- Payment confirm ---------------------------- */

/**
 * Confirm a captured payment. Safe to call concurrently (verify + webhook race):
 * only the caller that flips paymentStatus to 'paid' decrements stock and notifies.
 *
 * payment: { id, order_id, amount (paise), method } ; opts: { source, note }
 * Returns { order, alreadyPaid, autoRefunded }.
 */
const confirmPayment = async (orderId, payment = {}, opts = {}) => {
  const source = opts.source || 'api';
  const now = new Date();
  const entry = {
    orderId: payment.order_id,
    paymentId: payment.id || undefined,
    amount: payment.amount,
    currency: payment.currency || 'INR',
    status: 'paid',
    method: payment.method,
    source,
    signatureVerified: source !== 'manual_confirmation',
    note: opts.note,
    createdAt: now
  };

  // Normal path: unpaid (pending OR failed) and not cancelled → paid + confirmed.
  const won = await Order.findOneAndUpdate(
    { _id: orderId, paymentStatus: { $ne: 'paid' }, status: { $ne: 'cancelled' } },
    {
      $set: { paymentStatus: 'paid', status: 'confirmed', confirmedAt: now, paidAt: now, lastPaymentError: null },
      $unset: { cancelledAt: 1 },
      $push: {
        razorpayData: entry,
        statusHistory: { status: 'confirmed', deliveryStatus: 'PENDING', paymentStatus: 'paid', at: now, ...(opts.by ? { by: opts.by } : {}), note: `Payment received (${source})${opts.note ? `: ${opts.note}` : ''}` }
      }
    },
    { new: true }
  );

  if (won) {
    const results = await decrementStock(won);
    const set = {};
    results.forEach((r) => { set[`items.${r.index}.stockDeducted`] = r.deducted; });
    const shortfalls = results.filter((r) => r.shortfall > 0);
    if (shortfalls.length) {
      set.adminNotes = appendNote(
        won.adminNotes,
        `STOCK SHORTFALL at payment: ${shortfalls.map((s) => `${s.name} short by ${s.shortfall}`).join('; ')}`
      );
    }
    await Order.updateOne({ _id: won._id }, { $set: set });
    await assignInvoiceNumber(won._id); // exactly once, from the atomic per-FY counter

    await sendPaidNotifications(won._id);

    if (deliveryService.shouldCreateDelhiveryShipment(won)) {
      try {
        await require('../utils').createDelhiveryShipment(won._id);
      } catch (e) {
        console.error('Shipment creation failed (payment still confirmed):', e.message);
      }
    }
    return { order: await Order.findById(won._id), alreadyPaid: false, autoRefunded: false };
  }

  const current = await Order.findById(orderId);
  if (!current) throw httpError(404, 'Order not found');
  if (current.paymentStatus === 'paid') return { order: current, alreadyPaid: true, autoRefunded: false };

  // Captured on a cancelled order → record the money, then refund it in full automatically.
  if (current.status === 'cancelled') {
    if (source === 'manual_confirmation') throw httpError(409, 'Order is cancelled');
    const flipped = await Order.findOneAndUpdate(
      { _id: orderId, paymentStatus: { $ne: 'paid' }, status: 'cancelled' },
      {
        $set: {
          paymentStatus: 'paid',
          paidAt: now,
          stockRestored: true, // stock was never decremented — nothing to restock
          adminNotes: appendNote(current.adminNotes, 'Payment captured after cancellation — automatic full refund issued')
        },
        $push: {
          razorpayData: entry,
          statusHistory: { status: 'cancelled', deliveryStatus: current.deliveryStatus, paymentStatus: 'paid', at: now, note: 'Payment captured on a cancelled order — auto refund' }
        }
      },
      { new: true }
    );
    if (!flipped) return { order: await Order.findById(orderId), alreadyPaid: true, autoRefunded: false };
    await assignInvoiceNumber(orderId); // money was received → invoice + credit note
    let refunded = flipped;
    try {
      refunded = await refundOrder(orderId, {
        mode: 'razorpay',
        reason: 'Payment captured on a cancelled order',
        tolerateGatewayFailure: true
      });
    } catch (e) {
      console.error('Auto-refund for cancelled order failed:', e.message);
    }
    return { order: refunded, alreadyPaid: false, autoRefunded: true };
  }

  return { order: current, alreadyPaid: false, autoRefunded: false };
};

/* --------------------------------- Cancel -------------------------------- */

/**
 * Cancel an order (admin). refund: 'auto' | 'manual' | 'none'.
 * Restocks once (paid orders), refunds via refundOrder. Throws 404/409.
 */
const cancelOrder = async (orderId, { reason, refund = 'none', by } = {}) => {
  const order = await Order.findById(orderId);
  if (!order) throw httpError(404, 'Order not found');
  if (order.status === 'cancelled' || order.deliveryStatus === 'PRE_PICKUP_CANCEL') {
    throw httpError(409, 'Order is already cancelled');
  }
  if (order.status === 'delivered' || order.deliveryStatus === 'DELIVERED') {
    throw httpError(409, 'A delivered order cannot be cancelled — issue a refund instead');
  }
  const t = validateDeliveryTransition(order.deliveryStatus, 'PRE_PICKUP_CANCEL');
  if (!t.valid) throw httpError(409, `Order cannot be cancelled while ${order.deliveryStatus}`);

  const isPaid = order.paymentStatus === 'paid';
  const set = {
    status: 'cancelled',
    deliveryStatus: 'PRE_PICKUP_CANCEL',
    cancelledAt: new Date(),
    isDelayed: false
  };
  if (reason) set.cancelReason = String(reason).slice(0, 500);
  if (!isPaid) set.paymentStatus = 'cancelled';

  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: { $ne: 'cancelled' }, deliveryStatus: order.deliveryStatus },
    { $set: set, $push: { statusHistory: historyEntry({ ...order.toObject(), ...set }, { by, note: `Cancelled${reason ? `: ${reason}` : ''}` }) } },
    { new: true }
  );
  if (!updated) throw httpError(409, 'Order changed while cancelling; reload and retry');

  let refundError = null;
  if (isPaid) {
    await restockOrder(order._id);
    if (refund === 'auto' || refund === 'manual') {
      try {
        await refundOrder(order._id, {
          mode: refund === 'auto' ? 'razorpay' : 'manual',
          reason: reason || 'Order cancelled',
          by,
          tolerateGatewayFailure: true,
          skipEmail: true // the cancellation email already mentions the refund
        });
      } catch (e) {
        refundError = e.message; // cancellation stands; admin can retry the refund
      }
    }
  }

  const fresh = await Order.findById(order._id);
  if (isPaid) {
    const refundNote = fresh.refundedAmount > 0 ? ' and a refund is being processed' : '';
    await bestEffort(
      () => require('./push').notifyOrderUpdate(fresh, 'cancelled', {
        body: `Your order has been cancelled${refundNote}. (#${String(fresh._id).slice(-6).toUpperCase()})`
      }),
      3000,
      'cancel push'
    );
    const lastRefund = (fresh.refunds || []).filter((r) => r.status !== 'failed').at(-1);
    await bestEffort(
      () => require('./mailer').sendOrderEmail(fresh._id, 'cancelled', {
        reason,
        refundAmount: refund !== 'none' && lastRefund ? lastRefund.amount : 0,
        refundMode: lastRefund?.mode,
      }),
      6000,
      'cancel email'
    );
  }
  return { order: fresh, refundError };
};

/* ---------------------------- Refund webhooks ---------------------------- */

// refund.processed / refund.failed from Razorpay.
const applyRefundWebhook = async (event, refundEntity) => {
  if (!refundEntity?.id) return null;
  const status = event === 'refund.processed' ? 'processed' : 'failed';
  const amount = round2((refundEntity.amount || 0) / 100);
  const arn = refundEntity.acquirer_data?.arn || undefined;

  let order = await Order.findOne({ 'refunds.razorpayRefundId': refundEntity.id });
  if (order) {
    const r = order.refunds.find((x) => x.razorpayRefundId === refundEntity.id);
    if (r.status === status) {
      if (arn && !r.arn) await Order.updateOne({ _id: order._id, 'refunds.razorpayRefundId': refundEntity.id }, { $set: { 'refunds.$.arn': arn } });
      return order; // idempotent
    }
    const inc = status === 'failed' && r.status !== 'failed' ? -r.amount : status !== 'failed' && r.status === 'failed' ? r.amount : 0;
    await Order.updateOne(
      { _id: order._id, 'refunds.razorpayRefundId': refundEntity.id },
      {
        $set: { 'refunds.$.status': status, ...(arn ? { 'refunds.$.arn': arn } : {}) },
        ...(inc ? { $inc: { refundedAmount: inc } } : {}),
        $push: { statusHistory: historyEntry(order, { note: `Refund ₹${r.amount} ${status} (Razorpay)` }) }
      }
    );
    const synced = await syncRefundState(order._id);
    if (status === 'processed') await sendRefundEmail(order._id, r.amount, 'razorpay', arn || r.arn);
    return synced;
  }

  // Unknown refund id: maybe our API call hasn't stored the id yet, or it was issued from the dashboard.
  order = await Order.findOne({ 'razorpayData.paymentId': refundEntity.payment_id });
  if (!order) return null;
  const pendingMatch = order.refunds.find((x) => !x.razorpayRefundId && x.mode === 'razorpay' && x.status === 'pending' && Math.abs(x.amount - amount) < EPS);
  if (pendingMatch) {
    await Order.updateOne(
      { _id: order._id, 'refunds._id': pendingMatch._id },
      {
        $set: { 'refunds.$.status': status, 'refunds.$.razorpayRefundId': refundEntity.id, ...(arn ? { 'refunds.$.arn': arn } : {}) },
        ...(status === 'failed' ? { $inc: { refundedAmount: -pendingMatch.amount } } : {})
      }
    );
  } else if (status === 'processed') {
    await Order.updateOne(
      { _id: order._id },
      {
        $push: {
          refunds: { amount, reason: 'Refund issued from Razorpay dashboard', mode: 'razorpay', razorpayRefundId: refundEntity.id, arn, status: 'processed', createdAt: new Date() },
          statusHistory: historyEntry(order, { note: `Refund ₹${amount} processed (Razorpay dashboard)` })
        },
        $inc: { refundedAmount: amount }
      }
    );
  }
  const synced = await syncRefundState(order._id);
  if (status === 'processed') await sendRefundEmail(order._id, amount, 'razorpay', arn);
  return synced;
};

module.exports = {
  unitPriceOf,
  appendNote,
  decrementStock,
  restockOrder,
  sendPaidNotifications,
  computeRefundState,
  refundableAmountOf,
  syncRefundState,
  capturedPaymentId,
  refundOrder,
  confirmPayment,
  cancelOrder,
  applyRefundWebhook
};
