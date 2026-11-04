const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const { updateOrderSignals, getUpdatePermissions, historyEntry } = require('../utils/orderStatusDeriver');
const { invoiceTokenFor, verifyInvoiceToken, resolveDeliveryAddress } = require('../utils');
const { normalizePhone } = require('../utils/addressValidation');
const { istRangeFromQuery, DATE_RE } = require('../utils/dates');
const {
  asyncHandler, httpError, toStr, toList, toNum, isValidId, parsePagination,
  escapeRegex, escapeHtml, bestEffort, round2, sendCsv,
} = require('../utils/http');
const { isAdmin, assertOwnerOrAdmin } = require('../middleware');
const { normalizeProvider } = require('../services');
const {
  confirmPayment, cancelOrder: cancelOrderCore, refundOrder, refundableAmountOf, appendNote,
} = require('../services/orderService');


const ENUMS = {
  status: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'],
  paymentStatus: ['pending', 'paid', 'failed', 'cancelled'],
  deliveryStatus: ['PENDING', 'SHIPMENT_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RTO', 'PRE_PICKUP_CANCEL'],
  refundStatus: ['none', 'pending', 'partial', 'processed', 'failed'],
};
const UNPAID = ['pending', 'failed', 'cancelled'];

const POPULATE = [
  { path: 'userId', select: 'name email phone address isGuest' },
  { path: 'items.itemId', select: 'name price images' },
];

// Best-effort customer push for an order change (awaited with a short timeout).
const pushOrderUpdate = (order, statusKey, extra) =>
  bestEffort(() => require('../services/push').notifyOrderUpdate(order, statusKey, extra), 3000, 'order push');

const DELIVERY_STATUS_PUSH_KEY = {
  IN_TRANSIT: 'shipped',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
};
const DELIVERY_STATUS_EMAIL = { OUT_FOR_DELIVERY: 'out_for_delivery', DELIVERED: 'delivered' };

// razorpayData amounts are stored in PAISE; responses add amountRupees.
const withRupees = (list = []) =>
  list.map(({ signature, ...r }) => ({ ...r, amountRupees: r.amount != null ? round2(r.amount / 100) : null }));

/* -------------------------------- Shaping -------------------------------- */

const formatAddress = (address) => {
  if (!address) return 'Address not available';
  const { firstName = '', lastName = '', street = '', apartment = '', city = '', state = '', postcode = '' } = address;
  return `${firstName} ${lastName}, ${[street, apartment].filter(Boolean).join(', ')}, ${city}, ${state} - ${postcode}`.trim();
};

// Uses the order's tax snapshot (gstAmount); legacy orders were charged 5% on top.
const calculateOrderTotals = (o) => {
  const items = o.items || [];
  const subtotal = items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
  const scheme = o.gstScheme || 'regular';
  const tax = scheme !== 'regular' ? 0 : Number.isFinite(o.gstAmount) ? o.gstAmount : round2(subtotal * 0.05);
  return {
    subtotal: round2(subtotal),
    tax: round2(tax),
    taxIncluded: o.pricesIncludeGst === true,
    gstScheme: scheme,
    deliveryCharge: round2(o.shipping?.total || 0),
  };
};

const savedAddressOf = (o) =>
  (o.userId?.address || []).find((a) => String(a._id) === String(o.addressId)) || null;

// Phone priority: order.contactPhone → shippingAddress.phone → saved address phone → user.phone.
const customerContact = (o) => {
  const saved = savedAddressOf(o);
  const snap = o.shippingAddress || {};
  const pick = (...vals) => vals.map(normalizePhone).find(Boolean) || null;
  const customerPhone = pick(o.contactPhone, snap.phone, saved?.phone, o.userId?.phone);
  let customerAltPhone = pick(o.altPhone, snap.altPhone);
  if (customerAltPhone === customerPhone) customerAltPhone = null;
  const customerFirstName =
    snap.firstName || saved?.firstName || (o.userId?.name ? String(o.userId.name).trim().split(/\s+/)[0] : null) || null;
  return { customerPhone, customerAltPhone, customerFirstName };
};

const itemsOut = (items = []) =>
  items.map((i) => ({
    itemId: i.itemId && typeof i.itemId === 'object' && i.itemId._id
      ? { _id: i.itemId._id, name: i.itemId.name, ...(i.itemId.images ? { images: i.itemId.images } : {}) }
      : { _id: i.itemId, name: i.name || 'Unknown' },
    name: i.itemId?.name || i.name || 'Unknown',
    quantity: i.quantity,
    price: i.price,
    weight: i.weight,
  }));

// Admin order row (superset of the old /orders row).
const formatOrderData = (order) => {
  const o = order.toObject ? order.toObject() : order;
  const address = resolveDeliveryAddress(o);
  const { subtotal, tax, taxIncluded, gstScheme, deliveryCharge } = calculateOrderTotals(o);
  const latestPayment = [...(o.razorpayData || [])].reverse().find((p) => p.paymentId) || o.razorpayData?.at(-1) || {};
  const contact = customerContact(o);
  const items = itemsOut(o.items);

  return {
    _id: o._id,
    orderId: o._id,
    shortId: String(o._id).slice(-6).toUpperCase(),
    orderDate: o.createdAt,
    customerName: o.userId?.name || `${address?.firstName || ''} ${address?.lastName || ''}`.trim() || 'N/A',
    customerFirstName: contact.customerFirstName,
    customerEmail: o.shippingAddress?.email || o.userId?.email || 'N/A',
    customerPhone: contact.customerPhone,
    customerAltPhone: contact.customerAltPhone,
    userId: o.userId?._id || o.userId || null,
    isGuest: o.userId?.isGuest === true,
    deliveryAddress: formatAddress(address),
    shippingAddress: o.shippingAddress || null,
    items,
    itemsString: items.map((i) => `${i.name} (Qty: ${i.quantity}, ₹${i.price})`).join(', '),
    subtotal,
    tax,
    taxIncluded,
    gstScheme,
    deliveryCharge,
    platformFee: o.platformFee || 0,
    invoiceNumber: o.invoiceNumber || null,
    invoiceDate: o.invoiceDate || null,
    totalAmount: o.totalAmount,
    orderStatus: o.status,
    status: o.status,
    paymentStatus: o.paymentStatus,
    deliveryStatus: o.deliveryStatus || null,
    deliveryProvider: o.deliveryProvider || null,
    deliveryProviderDisplay: o.deliveryProviderDisplay || null,
    waybill: o.waybill || null,
    deliveryDate: o.deliveryDate || null,
    deliveredAt: o.deliveredAt || null,
    isDelayed: o.isDelayed || false,
    delayReason: o.delayReason || null,
    cancelReason: o.cancelReason || null,
    refundStatus: o.refundStatus || 'none',
    refundedAmount: o.refundedAmount || 0,
    refundableAmount: refundableAmountOf(o),
    refunds: o.refunds || [],
    razorpayOrderId: latestPayment.orderId || null,
    razorpayPaymentId: latestPayment.paymentId || null,
    paymentMethod: latestPayment.method || null,
    paymentAmount: latestPayment.amount ? latestPayment.amount / 100 : 0,
    paymentMode: o.paymentMode || 'PREPAID',
    confirmedAt: o.confirmedAt || null,
    paidAt: o.paidAt || (o.paymentStatus === 'paid' ? o.confirmedAt || null : null),
    shippedAt: o.shippedAt || null,
    outForDeliveryAt: o.outForDeliveryAt || null,
    cancelledAt: o.cancelledAt || null,
    statusHistory: o.statusHistory || [],
    adminNotes: o.adminNotes || null,
    invoiceToken: invoiceTokenFor(o._id),
    razorpayData: withRupees(o.razorpayData),
    lastPaymentError: o.lastPaymentError || [...(o.razorpayData || [])].reverse().find((p) => p.errorReason)?.errorReason || null,
    // legacy fields kept for existing admin screens
    shipping: o.shipping || null,
    shippingCharged: o.shipping?.charged || false,
    shippingRefunded: o.shipping?.refunded || false,
    shipmentCreated: o.shipmentCreated || false,
    shipmentAttempts: o.shipmentAttempts || 0,
    totalWeight: o.totalWeight || 0,
    distance: o.distance ?? null,
    contactPhone: o.contactPhone || null,
    altPhone: o.altPhone || null,
    rtoHandled: o.rtoHandled || false,
    stockRestored: o.stockRestored || false,
    currency: o.currency || 'INR',
  };
};

// Customer-facing order (full doc minus internal notes) + helpers the storefront reads.
const formatCustomerOrder = (order, req) => {
  const o = order.toObject ? order.toObject() : order;
  const out = {
    ...o,
    deliveryAddress: resolveDeliveryAddress(o),
    orderSummary: { ...calculateOrderTotals(o), platformFee: o.platformFee || 0, totalAmount: o.totalAmount },
    paymentDetails: { paymentStatus: o.paymentStatus, razorpayTransactions: withRupees(o.razorpayData) },
    invoiceToken: invoiceTokenFor(o._id),
    refundedAmount: o.refundedAmount || 0,
    refunds: (o.refunds || []).map(({ by, ...r }) => r),
    refundableAmount: refundableAmountOf(o),
  };
  if (out.userId && typeof out.userId === 'object') {
    out.userId = { _id: out.userId._id, name: out.userId.name, email: out.userId.email, phone: out.userId.phone };
  }
  delete out.razorpayData;
  delete out.adminNotes;
  out.statusHistory = (o.statusHistory || []).map(({ by, ...h }) => h);
  return out;
};

const loadOrder = async (rawId, populate = POPULATE) => {
  const id = rawId == null ? '' : typeof rawId === 'string' ? rawId : String(rawId);
  if (!isValidId(id)) throw httpError(400, 'Invalid order id');
  const q = Order.findById(id);
  if (populate) q.populate(populate);
  const order = await q;
  if (!order) throw httpError(404, 'Order not found');
  return order;
};

const respondAdminOrder = async (res, id, extra = {}) => {
  const order = await loadOrder(id);
  res.json({ success: true, order: formatOrderData(order), ...extra });
};

/* ------------------------------ Admin listing ----------------------------- */

const inEnum = (list, allowed) => list.filter((v) => allowed.includes(v));

const buildAdminFilter = async (query, { includeView = true } = {}) => {
  const and = [];

  const view = toStr(query.view) || 'paid';
  if (includeView) {
    if (view === 'paid') and.push({ paymentStatus: 'paid' });
    else if (view === 'unpaid') and.push({ paymentStatus: { $in: UNPAID } });
    else if (view !== 'all') throw httpError(400, 'view must be paid, unpaid or all');
  }

  for (const key of ['status', 'paymentStatus', 'refundStatus']) {
    const list = inEnum(toList(query[key]).map((v) => v.toLowerCase()), ENUMS[key]);
    if (list.length) and.push({ [key]: { $in: list } });
  }
  const ds = inEnum(toList(query.deliveryStatus).map((v) => v.toUpperCase()), ENUMS.deliveryStatus);
  if (ds.length) and.push({ deliveryStatus: { $in: ds } });

  const provider = normalizeProvider(toStr(query.deliveryProvider));
  if (toStr(query.deliveryProvider)) {
    if (!provider) throw httpError(400, 'deliveryProvider must be SELF or DELHIVERY');
    and.push({ deliveryProvider: provider });
  }

  const dateFilter = buildDateFilter(query);
  if (dateFilter) and.push(dateFilter);

  const minAmount = toNum(query.minAmount);
  const maxAmount = toNum(query.maxAmount);
  if (minAmount != null || maxAmount != null) {
    and.push({ totalAmount: { ...(minAmount != null ? { $gte: minAmount } : {}), ...(maxAmount != null ? { $lte: maxAmount } : {}) } });
  }

  const q = toStr(query.q).slice(0, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const or = [
      { waybill: rx },
      { 'shippingAddress.firstName': rx },
      { 'shippingAddress.lastName': rx },
      { 'shippingAddress.phone': rx },
      { 'shippingAddress.email': rx },
      { contactPhone: rx },
    ];
    if (/^[0-9a-f]{24}$/i.test(q)) or.push({ _id: new mongoose.Types.ObjectId(q) });
    else if (/^[0-9a-f]{6,23}$/i.test(q)) {
      or.push({ $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `${q}$`, options: 'i' } } });
    }
    const users = await User.find({ $or: [{ name: rx }, { email: rx }, { phone: rx }] }).select('_id').limit(500).lean();
    if (users.length) or.push({ userId: { $in: users.map((u) => u._id) } });
    and.push({ $or: or });
  }

  return and.length ? { $and: and } : {};
};

const buildDateFilter = (query) => {
  const from = toStr(query.from);
  const to = toStr(query.to);
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw httpError(400, 'from/to must be YYYY-MM-DD');
  const { start, end } = istRangeFromQuery(from, to);
  if (!start && !end) return null;
  return { createdAt: { ...(start ? { $gte: start } : {}), ...(end ? { $lt: end } : {}) } };
};

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  amount_desc: { totalAmount: -1, createdAt: -1 },
  amount_asc: { totalAmount: 1, createdAt: -1 },
};

exports.getAdminOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = await buildAdminFilter(req.query);
  const sort = SORTS[toStr(req.query.sort)] || SORTS.newest;
  const dateFilter = buildDateFilter(req.query) || {};

  const [orders, total, summaryAgg, paidCount, unpaidCount] = await Promise.all([
    Order.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    Order.countDocuments(filter),
    Order.aggregate([
      { $match: filter },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: '$totalAmount' }, refundedAmount: { $sum: { $ifNull: ['$refundedAmount', 0] } } } },
    ]),
    Order.countDocuments({ ...dateFilter, paymentStatus: 'paid' }),
    Order.countDocuments({ ...dateFilter, paymentStatus: { $in: UNPAID } }),
  ]);

  const s = summaryAgg[0] || {};
  res.json({
    success: true,
    orders: orders.map(formatOrderData),
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    summary: { count: s.count || 0, totalAmount: round2(s.totalAmount), refundedAmount: round2(s.refundedAmount) },
    counts: { paid: paidCount, unpaid: unpaidCount },
  });
});

exports.exportAdminOrders = asyncHandler(async (req, res) => {
  const filter = await buildAdminFilter(req.query);
  const sort = SORTS[toStr(req.query.sort)] || SORTS.newest;
  const orders = await Order.find(filter).populate(POPULATE).sort(sort).limit(5000);
  const rows = orders.map(formatOrderData).map((r) => [
    String(r._id), r.shortId, r.orderDate, r.customerName, r.customerFirstName, r.customerEmail, r.customerPhone, r.customerAltPhone,
    r.deliveryAddress, r.itemsString, r.subtotal, r.tax, r.deliveryCharge, r.platformFee, r.totalAmount,
    r.status, r.paymentStatus, r.deliveryStatus, r.deliveryProvider, r.waybill, r.deliveryDate,
    r.refundStatus, r.refundedAmount, r.razorpayPaymentId, r.paymentMethod, r.confirmedAt, r.cancelledAt, r.cancelReason,
  ]);
  sendCsv(res, `orders-${new Date().toISOString().slice(0, 10)}.csv`, [
    'Order ID', 'Short ID', 'Order Date', 'Customer', 'First Name', 'Email', 'Phone', 'Alt Phone',
    'Delivery Address', 'Items', 'Subtotal', 'GST', 'Delivery', 'Platform Fee', 'Total',
    'Status', 'Payment Status', 'Delivery Status', 'Provider', 'Waybill', 'Delivery Date',
    'Refund Status', 'Refunded', 'Razorpay Payment ID', 'Payment Method', 'Confirmed At', 'Cancelled At', 'Cancel Reason',
  ], rows);
});

// Legacy admin lists (kept for older admin screens).
exports.getAllOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10 });
  const query = { paymentStatus: 'paid' };
  const [orders, total] = await Promise.all([
    Order.find(query).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(query),
  ]);
  res.json({ success: true, orders: orders.map(formatOrderData), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

exports.getFailedOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10 });
  const query = { paymentStatus: { $in: UNPAID } };
  const [orders, total] = await Promise.all([
    Order.find(query).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(query),
  ]);
  res.json({ success: true, orders: orders.map(formatOrderData), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/* ----------------------------- Customer reads ----------------------------- */

// Only completed (paid) orders are ever shown to the customer.
exports.getMyOrders = asyncHandler(async (req, res) => {
  const userId = toStr(req.params.userId);
  if (!isValidId(userId)) throw httpError(400, 'Invalid user id');
  const orders = await Order.find({ userId, paymentStatus: 'paid' })
    .populate(POPULATE)
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ success: true, orders: orders.map((o) => formatCustomerOrder(o, req)) });
});

exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  assertOwnerOrAdmin(req, order.userId);
  if (isAdmin(req)) {
    await order.populate([{ path: 'statusHistory.by', select: 'name email' }, { path: 'refunds.by', select: 'name email' }]);
    return res.json({ success: true, order: formatOrderData(order) });
  }
  if (order.paymentStatus !== 'paid') throw httpError(404, 'Order not found');
  res.json({ success: true, order: formatCustomerOrder(order, req) });
});

exports.getOrderPermissions = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id, null);
  res.json({ success: true, permissions: getUpdatePermissions(order.deliveryProvider, 'ADMIN'), deliveryProvider: order.deliveryProvider });
});

/* ----------------------------- Admin actions ------------------------------ */

exports.updatePaymentStatus = asyncHandler(async (req, res) => {
  const target = toStr(req.body?.paymentStatus).toLowerCase();
  if (!ENUMS.paymentStatus.includes(target)) throw httpError(400, 'paymentStatus must be pending, failed, cancelled or paid');

  const order = await loadOrder(req.params.id, null);
  if (order.paymentStatus === 'paid') {
    if (target === 'paid') return respondAdminOrder(res, order._id);
    throw httpError(409, 'A paid order cannot be marked unpaid — issue a refund instead');
  }

  if (target === 'paid') {
    const note = toStr(req.body?.note);
    if (!note) throw httpError(400, 'A note is required when manually marking an order paid');
    await confirmPayment(order._id, {
      id: null,
      order_id: order.razorpayData?.[0]?.orderId,
      amount: Math.round(order.totalAmount * 100),
      method: 'manual',
    }, { source: 'manual_confirmation', by: req.user._id, note: `${note.slice(0, 300)} (by ${req.user.email || req.user._id})` });
    return respondAdminOrder(res, order._id);
  }

  if (target === order.paymentStatus) return respondAdminOrder(res, order._id);
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: { $ne: 'paid' } },
    {
      $set: { paymentStatus: target },
      $push: { statusHistory: historyEntry({ ...order.toObject(), paymentStatus: target }, { by: req.user._id, note: `Payment status set to ${target} by admin` }) }
    },
    { new: true }
  );
  if (!updated) throw httpError(409, 'Order was paid in the meantime');
  await respondAdminOrder(res, order._id);
});

// Apply a (non-cancel) delivery status change atomically. Returns the updated doc.
const applyDeliveryStatus = async (order, deliveryStatus, by) => {
  if (deliveryStatus === 'PRE_PICKUP_CANCEL') {
    return (await cancelOrderCore(order._id, { reason: 'Cancelled by admin', refund: 'none', by })).order;
  }
  const fields = updateOrderSignals(order, { deliveryStatus }, { source: 'ADMIN' });
  if (!Object.keys(fields).length) return order;
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, deliveryStatus: order.deliveryStatus },
    { $set: fields, $push: { statusHistory: historyEntry({ ...order.toObject(), ...fields }, { by }) } },
    { new: true }
  ).populate('userId', 'name');
  if (!updated) throw httpError(409, 'Order changed in the meantime; reload and retry');
  const key = DELIVERY_STATUS_PUSH_KEY[deliveryStatus];
  if (key) await pushOrderUpdate(updated, key);
  const mailKind = DELIVERY_STATUS_EMAIL[deliveryStatus];
  if (mailKind) await bestEffort(() => require('../services/mailer').sendOrderEmail(updated._id, mailKind), 6000, 'delivery email');
  return updated;
};

exports.updateDeliveryStatus = asyncHandler(async (req, res) => {
  const deliveryStatus = toStr(req.body?.deliveryStatus).toUpperCase();
  if (!ENUMS.deliveryStatus.includes(deliveryStatus)) throw httpError(400, 'Invalid delivery status');
  const order = await loadOrder(req.params.id, null);
  if (normalizeProvider(order.deliveryProvider) !== 'SELF') {
    throw httpError(409, 'Delivery status of courier orders is updated by the courier only');
  }
  await applyDeliveryStatus(order, deliveryStatus, req.user._id);
  await respondAdminOrder(res, order._id);
});

exports.updateStatus = asyncHandler(async (req, res) => {
  const status = toStr(req.body?.status).toLowerCase();
  if (!ENUMS.status.includes(status)) throw httpError(400, 'Invalid status');
  const order = await loadOrder(req.params.id, null);

  if (status === 'cancelled') {
    const refund = ['auto', 'manual', 'none'].includes(toStr(req.body?.refund)) ? toStr(req.body.refund) : 'none';
    const { refundError } = await cancelOrderCore(order._id, { reason: toStr(req.body?.reason) || 'Cancelled by admin', refund, by: req.user._id });
    return respondAdminOrder(res, order._id, refundError ? { refundError } : {});
  }
  if (status === order.status) return respondAdminOrder(res, order._id);

  if (status === 'confirmed' || status === 'pending' || status === 'failed') {
    // `confirmed` never changes paymentStatus (use payment-status for a manual payment).
    throw httpError(409, status === 'confirmed' && order.paymentStatus !== 'paid'
      ? 'Order is not paid — mark the payment as paid first'
      : `Cannot move order from ${order.status} to ${status}`);
  }
  if (normalizeProvider(order.deliveryProvider) !== 'SELF') {
    throw httpError(409, 'Status of courier orders is updated by the courier only');
  }
  await applyDeliveryStatus(order, status === 'shipped' ? 'OUT_FOR_DELIVERY' : 'DELIVERED', req.user._id);
  await respondAdminOrder(res, order._id);
});

exports.bulkUpdateStatus = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(toStr).filter(Boolean).slice(0, 200) : [];
  const deliveryStatus = toStr(req.body?.deliveryStatus).toUpperCase();
  if (!ids.length || !ENUMS.deliveryStatus.includes(deliveryStatus)) {
    throw httpError(400, 'orderIds[] and a valid deliveryStatus are required');
  }
  let updated = 0;
  const failed = [];
  for (const id of ids) {
    try {
      const order = await loadOrder(id, null);
      if (normalizeProvider(order.deliveryProvider) !== 'SELF') throw httpError(409, 'Courier order — status is updated by the courier');
      await applyDeliveryStatus(order, deliveryStatus, req.user._id);
      updated += 1;
    } catch (e) {
      failed.push({ id, message: e.expose || e.status < 500 ? e.message : 'Update failed' });
    }
  }
  res.json({ success: true, updated, failed });
});

exports.cancelOrder = asyncHandler(async (req, res) => {
  const refund = toStr(req.body?.refund) || 'none';
  if (!['auto', 'manual', 'none'].includes(refund)) throw httpError(400, "refund must be 'auto', 'manual' or 'none'");
  const order = await loadOrder(req.params.id, null);
  const { refundError } = await cancelOrderCore(order._id, { reason: toStr(req.body?.reason), refund, by: req.user._id });
  await respondAdminOrder(res, order._id, refundError ? { refundError } : {});
});

exports.refundOrder = asyncHandler(async (req, res) => {
  const mode = toStr(req.body?.mode) || 'razorpay';
  if (!['razorpay', 'manual'].includes(mode)) throw httpError(400, "mode must be 'razorpay' or 'manual'");
  const reason = toStr(req.body?.reason);
  if (!reason) throw httpError(400, 'A refund reason is required');
  const rawAmount = req.body?.amount;
  let amount;
  if (rawAmount != null && rawAmount !== '') {
    amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'amount must be a positive number');
  }
  const restock = req.body?.restock === true || req.body?.restock === 'true';
  const order = await loadOrder(req.params.id, null);
  await refundOrder(order._id, { amount, reason: reason.slice(0, 500), mode, restock, by: req.user._id });
  await respondAdminOrder(res, order._id);
});

exports.markDelayed = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id, null);
  const { isDelayed, delayReason, deliveryDate } = req.body || {};
  order.isDelayed = isDelayed === undefined ? true : isDelayed === true || isDelayed === 'true';
  if (delayReason !== undefined) order.delayReason = toStr(delayReason).slice(0, 300);
  if (deliveryDate) {
    const d = new Date(toStr(deliveryDate));
    if (isNaN(d.getTime())) throw httpError(400, 'Invalid delivery date');
    order.deliveryDate = d;
  }
  await order.save();

  if (order.isDelayed && order.paymentStatus === 'paid') {
    const when = order.deliveryDate
      ? ` New date: ${new Date(order.deliveryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}.`
      : '';
    await pushOrderUpdate(order, 'delayed', {
      body: `Your order delivery has been rescheduled.${when}${order.delayReason ? ` Reason: ${order.delayReason}.` : ''} (#${String(order._id).slice(-6).toUpperCase()})`,
    });
  }
  res.json({ success: true, order: { _id: order._id, isDelayed: order.isDelayed, delayReason: order.delayReason, deliveryDate: order.deliveryDate } });
});

exports.updateAdminNotes = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id, null);
  order.adminNotes = toStr(req.body?.adminNotes).slice(0, 5000);
  await order.save();
  res.json({ success: true, adminNotes: order.adminNotes });
});

exports.updateDeliveryDate = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id, null);
  const raw = toStr(req.body?.deliveryDate);
  if (raw) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) throw httpError(400, 'Invalid delivery date');
    order.deliveryDate = d;
  } else {
    order.deliveryDate = undefined;
  }
  await order.save();

  if (order.deliveryDate && order.paymentStatus === 'paid') {
    const dateStr = new Date(order.deliveryDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
    await pushOrderUpdate(order, 'delivery_date', {
      body: `Your order is scheduled for delivery on ${dateStr}. (#${String(order._id).slice(-6).toUpperCase()})`,
    });
  }
  res.json({ success: true, deliveryDate: order.deliveryDate });
});

/* ------------------------------ Customer edits ----------------------------- */

exports.updateOrderContact = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id, null);
  assertOwnerOrAdmin(req, order.userId);

  const locked = ['delivered', 'cancelled', 'failed'].includes(order.status)
    || ['DELIVERED', 'RTO', 'PRE_PICKUP_CANCEL'].includes(order.deliveryStatus);
  if (locked) throw httpError(409, 'Contact can no longer be updated for this order');

  const { contactPhone, altPhone } = req.body || {};
  if (contactPhone !== undefined) {
    const raw = toStr(contactPhone);
    const n = raw ? normalizePhone(raw) : '';
    if (raw && !n) throw httpError(400, 'Enter a valid 10-digit contact number');
    order.contactPhone = n || undefined;
  }
  if (altPhone !== undefined) {
    const raw = toStr(altPhone);
    const n = raw ? normalizePhone(raw) : '';
    if (raw && !n) throw httpError(400, 'Enter a valid 10-digit alternate number');
    if (n && n === order.contactPhone) throw httpError(400, 'Alternate number must differ from the contact number');
    order.altPhone = n || undefined;
  }
  await order.save();
  res.json({ success: true, contactPhone: order.contactPhone || null, altPhone: order.altPhone || null });
});

/* -------------------- INVOICE (signed link, printable HTML) -------------------- */
exports.getInvoice = asyncHandler(async (req, res) => {
  const { renderInvoiceHtml } = require('../utils/invoice');
  const id = toStr(req.params.id);
  const token = toStr(req.query.t);
  const deny = (status, msg) => {
    if (req.accepts(['html', 'json']) === 'json') return res.status(status).json({ success: false, message: msg });
    return res.status(status).type('html').send(`<h1 style="font-family:sans-serif;text-align:center;margin-top:40px;">${escapeHtml(msg)}</h1>`);
  };
  if (!isValidId(id) || !verifyInvoiceToken(id, token)) return deny(403, 'Invalid or missing invoice link');

  const order = await Order.findById(id).populate('userId', 'name email phone address').populate('items.itemId', 'name price');
  if (!order) return deny(404, 'Invoice not found');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const { getSettings, brandFromSettings } = require('../services/settings');
  res.send(renderInvoiceHtml(order, brandFromSettings(await getSettings())));
});

/* -------------------- SEND / RESEND ORDER CONFIRMATION EMAIL (admin) -------------------- */
exports.sendConfirmation = asyncHandler(async (req, res) => {
  const { sendOrderConfirmationEmail } = require('../services/mailer');
  const order = await loadOrder(req.params.id, null);
  if (order.paymentStatus !== 'paid') throw httpError(409, 'Only paid orders get a confirmation email');
  const baseUrl = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const result = await sendOrderConfirmationEmail(order._id, { baseUrl });
  if (result.success) return res.json({ success: true, message: 'Confirmation email sent.' });
  if (result.skipped) throw httpError(503, 'Email is not configured on the server.');
  throw httpError(502, 'Failed to send email.');
});

exports._internal = { formatOrderData, formatCustomerOrder, customerContact, appendNote };
