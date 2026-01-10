const Item = require('../models/Item');
const Category = require('../models/Category');
const User = require('../models/User');
const Order = require('../models/Order');

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const createSearchRegex = (query) => new RegExp(query, 'i');

const STOCK_FILTER = { stockQty: { $gt: 0 } };
const ACTIVE_STATUS = { status: 'Active' };

exports.globalSearch = asyncHandler(async (req, res) => {
  const { q, type, limit = 10 } = req.query;
  
  if (!q) {
    return res.status(400).json({ message: 'Search query is required' });
  }

  const searchRegex = createSearchRegex(q);
  const results = {};
  const searchLimit = parseInt(limit);

  const searchQueries = [];

  if (!type || type === 'items') {
    searchQueries.push(
      Item.find({
        $or: [{ name: searchRegex }, { shortDesc: searchRegex }, { longDesc: searchRegex }],
        ...ACTIVE_STATUS,
        ...STOCK_FILTER
      })
      .populate('category', 'name')
      .populate('subcategory', 'name')
      .limit(searchLimit)
      .select('name price discountPrice images shortDesc category subcategory')
      .then(items => { results.items = items; })
    );
  }

  if (!type || type === 'categories') {
    searchQueries.push(
      Category.find({ name: searchRegex, ...ACTIVE_STATUS })
      .limit(searchLimit)
      .select('name')
      .then(categories => { results.categories = categories; })
    );
  }

  if (!type || type === 'customers') {
    searchQueries.push(
      User.find({
        $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }],
        status: 'active'
      })
      .limit(searchLimit)
      .select('name email phone')
      .then(customers => { results.customers = customers; })
    );
  }

  if (!type || type === 'orders') {
    searchQueries.push(
      Order.find()
      .populate({ path: 'customerId', match: { name: searchRegex }, select: 'name email' })
      .populate('items.itemId', 'name')
      .limit(searchLimit)
      .select('customerId totalAmount status paymentStatus createdAt')
      .then(orders => { results.orders = orders.filter(order => order.customerId); })
    );
  }

  await Promise.all(searchQueries);
  res.json(results);
});

exports.searchItems = asyncHandler(async (req, res) => {
  const { q, category, subcategory, minPrice, maxPrice, isBestSeller, isOnSale, limit = 20, page = 1 } = req.query;

  const query = { ...ACTIVE_STATUS, ...STOCK_FILTER };
  
  if (q) {
    const searchRegex = createSearchRegex(q);
    query.$or = [{ name: searchRegex }, { shortDesc: searchRegex }, { longDesc: searchRegex }];
  }

  if (category) query.category = category;
  if (subcategory) query.subcategory = subcategory;
  if (minPrice || maxPrice) {
    query.price = {};
    if (minPrice) query.price.$gte = parseFloat(minPrice);
    if (maxPrice) query.price.$lte = parseFloat(maxPrice);
  }
  if (isBestSeller === 'true') query.isBestSeller = true;
  if (isOnSale === 'true') query.isOnSale = true;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;
  
  const [items, total] = await Promise.all([
    Item.find(query)
      .populate('category', 'name')
      .populate('subcategory', 'name')
      .skip(skip)
      .limit(limitNum)
      .sort({ createdAt: -1 }),
    Item.countDocuments(query)
  ]);

  res.json({
    items,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      hasNext: skip + items.length < total,
      hasPrev: pageNum > 1
    }
  });
});

exports.searchCustomers = asyncHandler(async (req, res) => {
  const { q, status, limit = 20, page = 1 } = req.query;
  
  const query = {};
  
  if (q) {
    const searchRegex = createSearchRegex(q);
    query.$or = [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }];
  }
  
  if (status) query.status = status;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;
  
  const [customers, total] = await Promise.all([
    User.find(query).skip(skip).limit(limitNum).sort({ createdAt: -1 }),
    User.countDocuments(query)
  ]);

  res.json({
    customers,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total
    }
  });
});

exports.searchOrders = asyncHandler(async (req, res) => {
  const { q, status, paymentStatus, limit = 20, page = 1 } = req.query;
  
  const query = {};
  if (status) query.status = status;
  if (paymentStatus) query.paymentStatus = paymentStatus;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;
  
  let orders = await Order.find(query)
    .populate('customerId', 'name email phone')
    .populate('items.itemId', 'name price')
    .skip(skip)
    .limit(limitNum)
    .sort({ createdAt: -1 });

  if (q) {
    const searchRegex = createSearchRegex(q);
    orders = orders.filter(order => 
      order.customerId && (
        searchRegex.test(order.customerId.name) ||
        searchRegex.test(order.customerId.email) ||
        searchRegex.test(order.customerId.phone)
      )
    );
  }

  const total = await Order.countDocuments(query);

  res.json({
    orders,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total
    }
  });
});