const Order = require('../models/Order');
const User = require('../models/User');
const Item = require('../models/Item');
const { asyncHandler, httpError, toStr, round2, sendCsv } = require('../utils/http');
const { TZ, DAY_MS, DATE_RE, istDateString, istStartOfDay, addDaysYmd, daysBetweenInclusive } = require('../utils/dates');

const UNPAID = ['pending', 'failed', 'cancelled'];
const MAX_RANGE_DAYS = 731;

// Revenue is bucketed by confirmedAt (when the payment completed), falling back to createdAt.
const BUCKET_DATE = { $ifNull: ['$confirmedAt', '$createdAt'] };

const resolveRange = (query) => {
  const toQ = toStr(query.to);
  const fromQ = toStr(query.from);
  if ((fromQ && !DATE_RE.test(fromQ)) || (toQ && !DATE_RE.test(toQ))) throw httpError(400, 'from/to must be YYYY-MM-DD');
  const to = toQ || istDateString();
  const from = fromQ || addDaysYmd(to, -29);
  if (!istStartOfDay(from) || !istStartOfDay(to)) throw httpError(400, 'Invalid date');
  if (from > to) throw httpError(400, '`from` must be on or before `to`');
  const days = daysBetweenInclusive(from, to);
  if (days > MAX_RANGE_DAYS) throw httpError(400, `Range is limited to ${MAX_RANGE_DAYS} days`);
  return { from, to, days, start: istStartOfDay(from), end: new Date(istStartOfDay(to).getTime() + DAY_MS) };
};

const paidMatch = (start, end) => ({
  paymentStatus: 'paid',
  $or: [
    { confirmedAt: { $gte: start, $lt: end } },
    { confirmedAt: null, createdAt: { $gte: start, $lt: end } },
  ],
});

const refundsInRange = (start, end, groupId = null) => Order.aggregate([
  { $match: { 'refunds.createdAt': { $gte: start, $lt: end } } },
  { $unwind: '$refunds' },
  { $match: { 'refunds.createdAt': { $gte: start, $lt: end }, 'refunds.status': { $ne: 'failed' } } },
  { $group: { _id: groupId, amount: { $sum: '$refunds.amount' } } },
]);

const computeKpis = async (start, end) => {
  const match = paidMatch(start, end);
  const [paidAgg, itemsAgg, refundAgg, unpaidOrders, newCustomers, customerIds] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          gross: { $sum: '$totalAmount' },
          count: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
    ]),
    Order.aggregate([
      { $match: { ...match, status: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      { $group: { _id: null, qty: { $sum: '$items.quantity' } } },
    ]),
    refundsInRange(start, end),
    Order.countDocuments({ paymentStatus: { $in: UNPAID }, createdAt: { $gte: start, $lt: end } }),
    User.countDocuments({ role: 'user', createdAt: { $gte: start, $lt: end } }),
    Order.distinct('userId', match),
  ]);

  let repeatCustomerRate = 0;
  if (customerIds.length) {
    const repeat = await Order.aggregate([
      { $match: { userId: { $in: customerIds }, paymentStatus: 'paid', $expr: { $lt: [BUCKET_DATE, end] } } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
      { $match: { n: { $gte: 2 } } },
      { $count: 'repeat' },
    ]);
    repeatCustomerRate = round2(((repeat[0]?.repeat || 0) / customerIds.length) * 100);
  }

  const gross = round2(paidAgg[0]?.gross || 0);
  const refunds = round2(refundAgg[0]?.amount || 0);
  const paidOrders = paidAgg[0]?.count || 0;
  return {
    grossRevenue: gross,
    refunds,
    netRevenue: round2(gross - refunds),
    paidOrders,
    avgOrderValue: paidOrders ? round2(gross / paidOrders) : 0,
    unpaidOrders,
    cancelledOrders: paidAgg[0]?.cancelled || 0,
    itemsSold: itemsAgg[0]?.qty || 0,
    newCustomers,
    repeatCustomerRate, // percent (0–100) of this period's buyers with ≥ 2 paid orders to date
  };
};

const salesByDay = async ({ from, days, start, end }) => {
  const dayKey = (date) => ({ $dateToString: { format: '%Y-%m-%d', date, timezone: TZ } });
  const [sales, refunds] = await Promise.all([
    Order.aggregate([
      { $match: paidMatch(start, end) },
      { $group: { _id: dayKey(BUCKET_DATE), revenue: { $sum: '$totalAmount' }, orders: { $sum: 1 } } },
    ]),
    refundsInRange(start, end, dayKey('$refunds.createdAt')),
  ]);
  const s = new Map(sales.map((r) => [r._id, r]));
  const rf = new Map(refunds.map((r) => [r._id, r.amount]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysYmd(from, i);
    out.push({ date, revenue: round2(s.get(date)?.revenue || 0), orders: s.get(date)?.orders || 0, refunds: round2(rf.get(date) || 0) });
  }
  return out;
};

const productSales = (start, end, limit) => Order.aggregate([
  { $match: { ...paidMatch(start, end), status: { $ne: 'cancelled' } } },
  { $unwind: '$items' },
  {
    $group: {
      _id: '$items.itemId',
      name: { $first: '$items.name' },
      quantity: { $sum: '$items.quantity' },
      revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
    },
  },
  { $sort: { revenue: -1 } },
  ...(limit ? [{ $limit: limit }] : []),
  { $lookup: { from: 'items', localField: '_id', foreignField: '_id', as: 'item' } },
  {
    $project: {
      _id: 0,
      itemId: '$_id',
      name: { $ifNull: [{ $arrayElemAt: ['$item.name', 0] }, { $ifNull: ['$name', 'Deleted item'] }] },
      quantity: 1,
      revenue: { $round: ['$revenue', 2] },
    },
  },
]);

const categorySales = (start, end) => Order.aggregate([
  { $match: { ...paidMatch(start, end), status: { $ne: 'cancelled' } } },
  { $unwind: '$items' },
  { $lookup: { from: 'items', localField: 'items.itemId', foreignField: '_id', as: 'item' } },
  { $addFields: { categoryId: { $arrayElemAt: [{ $ifNull: [{ $arrayElemAt: ['$item.categories', 0] }, []] }, 0] } } },
  {
    $group: {
      _id: '$categoryId',
      quantity: { $sum: '$items.quantity' },
      revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
    },
  },
  { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'cat' } },
  {
    $project: {
      _id: 0,
      categoryId: '$_id',
      name: { $ifNull: [{ $arrayElemAt: ['$cat.name', 0] }, 'Uncategorised'] },
      quantity: 1,
      revenue: { $round: ['$revenue', 2] },
    },
  },
  { $sort: { revenue: -1 } },
]);

const customerSales = (start, end, limit) => Order.aggregate([
  { $match: paidMatch(start, end) },
  { $group: { _id: '$userId', orders: { $sum: 1 }, spent: { $sum: '$totalAmount' } } },
  { $sort: { spent: -1 } },
  ...(limit ? [{ $limit: limit }] : []),
  { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
  {
    $project: {
      _id: 0,
      userId: '$_id',
      name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, 'Unknown'] },
      email: { $ifNull: [{ $arrayElemAt: ['$u.email', 0] }, ''] },
      phone: { $ifNull: [{ $arrayElemAt: ['$u.phone', 0] }, ''] },
      isGuest: { $ifNull: [{ $arrayElemAt: ['$u.isGuest', 0] }, false] },
      orders: 1,
      spent: { $round: ['$spent', 2] },
    },
  },
]);

exports.getSummary = asyncHandler(async (req, res) => {
  const range = resolveRange(req.query);
  const prevTo = addDaysYmd(range.from, -1);
  const prevFrom = addDaysYmd(prevTo, -(range.days - 1));
  const prevStart = istStartOfDay(prevFrom);
  const prevEnd = new Date(istStartOfDay(prevTo).getTime() + DAY_MS);
  const { start, end } = range;

  const [kpis, previous, byDay, topProducts, salesByCategory, paymentBreakdown, fulfillment, topCustomers, lowStock] =
    await Promise.all([
      computeKpis(start, end),
      computeKpis(prevStart, prevEnd),
      salesByDay(range),
      productSales(start, end, 10),
      categorySales(start, end),
      Order.aggregate([
        { $match: { createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: '$paymentStatus', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
        { $project: { _id: 0, status: '$_id', count: 1, amount: { $round: ['$amount', 2] } } },
        { $sort: { count: -1 } },
      ]),
      Order.aggregate([
        { $match: paidMatch(start, end) },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } },
        { $sort: { count: -1 } },
      ]),
      customerSales(start, end, 10),
      Item.find({ status: { $ne: 'inactive' }, stockQty: { $lte: 5 } }).select('name stockQty').sort({ stockQty: 1 }).limit(100).lean(),
    ]);

  res.json({
    success: true,
    range: { from: range.from, to: range.to },
    kpis,
    previous,
    salesByDay: byDay,
    topProducts,
    salesByCategory,
    paymentBreakdown,
    fulfillmentBreakdown: fulfillment,
    topCustomers: topCustomers.map(({ phone, isGuest, ...c }) => c),
    lowStock,
  });
});

exports.exportReport = asyncHandler(async (req, res) => {
  const type = toStr(req.query.type) || 'sales';
  const range = resolveRange(req.query);
  const suffix = `${range.from}_to_${range.to}`;

  if (type === 'sales') {
    const rows = (await salesByDay(range)).map((d) => [d.date, d.orders, d.revenue, d.refunds, round2(d.revenue - d.refunds)]);
    return sendCsv(res, `sales_${suffix}.csv`, ['Date', 'Paid Orders', 'Revenue', 'Refunds', 'Net'], rows);
  }
  if (type === 'products') {
    const rows = (await productSales(range.start, range.end, 0)).map((p) => [String(p.itemId), p.name, p.quantity, p.revenue]);
    return sendCsv(res, `products_${suffix}.csv`, ['Item ID', 'Name', 'Quantity', 'Revenue'], rows);
  }
  if (type === 'customers') {
    const rows = (await customerSales(range.start, range.end, 5000)).map((c) => [String(c.userId), c.name, c.email, c.phone, c.isGuest ? 'yes' : 'no', c.orders, c.spent]);
    return sendCsv(res, `customers_${suffix}.csv`, ['User ID', 'Name', 'Email', 'Phone', 'Guest', 'Orders', 'Spent'], rows);
  }
  throw httpError(400, 'type must be sales, products or customers');
});
