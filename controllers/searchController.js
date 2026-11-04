const Item = require('../models/Item');
const Category = require('../models/Category');
const User = require('../models/User');
const Order = require('../models/Order');
const { asyncHandler, httpError, toStr, escapeRegex, parsePagination, toNum, isValidId } = require('../utils/http');

// User input is always regex-escaped (no ReDoS / pattern injection).
const createSearchRegex = (query) => new RegExp(escapeRegex(String(query).slice(0, 100)), 'i');

const STOCK_FILTER = { stockQty: { $gt: 0 } };
const ACTIVE_STATUS = { status: 'active' };
const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled'];

// Admin global search.
exports.globalSearch = asyncHandler(async (req, res) => {
  const q = toStr(req.query.q);
  const type = toStr(req.query.type);
  if (!q) throw httpError(400, 'Search query is required');

  const searchRegex = createSearchRegex(q);
  const searchLimit = Math.min(50, Math.max(1, parseInt(toStr(req.query.limit), 10) || 10));
  const results = {};
  const tasks = [];

  if (!type || type === 'items') {
    tasks.push(
      Item.find({ $or: [{ name: searchRegex }, { shortDesc: searchRegex }, { longDesc: searchRegex }], ...ACTIVE_STATUS })
        .populate('categories', 'name')
        .populate('subcategories', 'name')
        .limit(searchLimit)
        .select('name price discountPrice images shortDesc categories subcategories stockQty')
        .then((items) => { results.items = items; })
    );
  }
  if (!type || type === 'categories') {
    tasks.push(
      Category.find({ name: searchRegex, ...ACTIVE_STATUS }).limit(searchLimit).select('name')
        .then((categories) => { results.categories = categories; })
    );
  }
  if (!type || type === 'customers') {
    tasks.push(
      User.find({ $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }] })
        .limit(searchLimit)
        .select('name email phone status isGuest')
        .then((customers) => { results.customers = customers; })
    );
  }
  if (!type || type === 'orders') {
    tasks.push((async () => {
      const users = await User.find({ $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }] }).select('_id').limit(200);
      const or = [{ userId: { $in: users.map((u) => u._id) } }, { waybill: searchRegex }];
      if (isValidId(q)) or.push({ _id: q });
      results.orders = await Order.find({ $or: or })
        .populate('userId', 'name email')
        .populate('items.itemId', 'name')
        .sort({ createdAt: -1 })
        .limit(searchLimit)
        .select('userId totalAmount status paymentStatus createdAt waybill');
    })());
  }

  await Promise.all(tasks);
  res.json({ success: true, ...results });
});

// Public storefront search.
exports.searchItems = asyncHandler(async (req, res) => {
  const q = toStr(req.query.q);
  const category = toStr(req.query.category);
  const subcategory = toStr(req.query.subcategory);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 1000 });

  const query = { ...ACTIVE_STATUS, ...STOCK_FILTER };
  if (q) {
    const searchRegex = createSearchRegex(q);
    query.$or = [{ name: searchRegex }, { shortDesc: searchRegex }, { longDesc: searchRegex }];
  }
  if (category) {
    if (!isValidId(category)) throw httpError(400, 'Invalid category');
    query.categories = category;
  }
  if (subcategory) {
    if (!isValidId(subcategory)) throw httpError(400, 'Invalid subcategory');
    query.subcategories = subcategory;
  }
  const minPrice = toNum(req.query.minPrice);
  const maxPrice = toNum(req.query.maxPrice);
  if (minPrice != null || maxPrice != null) {
    query.price = {};
    if (minPrice != null) query.price.$gte = minPrice;
    if (maxPrice != null) query.price.$lte = maxPrice;
  }
  if (toStr(req.query.isBestSeller) === 'true') query.isBestSeller = true;
  if (toStr(req.query.isOnSale) === 'true') query.isOnSale = true;

  const [items, total] = await Promise.all([
    Item.find(query).populate('categories', 'name').populate('subcategories', 'name').skip(skip).limit(limit).sort({ createdAt: -1 }),
    Item.countDocuments(query),
  ]);

  res.json({
    success: true,
    items,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      hasNext: skip + items.length < total,
      hasPrev: page > 1,
    },
  });
});

// Admin.
exports.searchCustomers = asyncHandler(async (req, res) => {
  const q = toStr(req.query.q);
  const status = toStr(req.query.status);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

  const query = {};
  if (q) {
    const searchRegex = createSearchRegex(q);
    query.$or = [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }];
  }
  if (status) {
    if (!['active', 'inactive'].includes(status)) throw httpError(400, 'Invalid status');
    query.status = status;
  }

  const [customers, total] = await Promise.all([
    User.find(query).select('-password').skip(skip).limit(limit).sort({ createdAt: -1 }),
    User.countDocuments(query),
  ]);

  res.json({
    success: true,
    customers,
    pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalItems: total },
  });
});

// Admin.
exports.searchOrders = asyncHandler(async (req, res) => {
  const q = toStr(req.query.q);
  const status = toStr(req.query.status);
  const paymentStatus = toStr(req.query.paymentStatus);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

  const query = {};
  if (status) {
    if (!ORDER_STATUSES.includes(status)) throw httpError(400, 'Invalid status');
    query.status = status;
  }
  if (paymentStatus) {
    if (!PAYMENT_STATUSES.includes(paymentStatus)) throw httpError(400, 'Invalid paymentStatus');
    query.paymentStatus = paymentStatus;
  }
  if (q) {
    const searchRegex = createSearchRegex(q);
    const users = await User.find({ $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }] }).select('_id').limit(500);
    const or = [{ userId: { $in: users.map((u) => u._id) } }, { waybill: searchRegex }, { 'shippingAddress.phone': searchRegex }];
    if (isValidId(q)) or.push({ _id: q });
    query.$or = or;
  }

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate('userId', 'name email phone isGuest')
      .populate('items.itemId', 'name price')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    Order.countDocuments(query),
  ]);

  res.json({
    success: true,
    orders,
    pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalItems: total },
  });
});
