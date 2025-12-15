const Item = require('../models/Item');
const Category = require('../models/Category');
const User = require('../models/User');
const Order = require('../models/Order');

// Global search across all entities
exports.globalSearch = async (req, res) => {
  try {
    const { q, type, limit = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const searchRegex = new RegExp(q, 'i');
    const results = {};

    if (!type || type === 'items') {
      results.items = await Item.find({
        $or: [
          { name: searchRegex },
          { shortDesc: searchRegex },
          { longDesc: searchRegex }
        ],
        status: 'Active'
      })
      .populate('category', 'name')
      .populate('subcategory', 'name')
      .limit(parseInt(limit))
      .select('name price discountPrice images shortDesc category subcategory');
    }

    if (!type || type === 'categories') {
      results.categories = await Category.find({
        name: searchRegex,
        status: 'Active'
      })
      .limit(parseInt(limit))
      .select('name');
    }

    if (!type || type === 'customers') {
      results.customers = await User.find({
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { phone: searchRegex }
        ],
        status: 'active'
      })
      .limit(parseInt(limit))
      .select('name email phone');
    }

    if (!type || type === 'orders') {
      results.orders = await Order.find()
      .populate({
        path: 'customerId',
        match: { name: searchRegex },
        select: 'name email'
      })
      .populate('items.itemId', 'name')
      .limit(parseInt(limit))
      .select('customerId totalAmount status paymentStatus createdAt');
      
      results.orders = results.orders.filter(order => order.customerId);
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Search items with filters
exports.searchItems = async (req, res) => {
  try {
    const { 
      q, 
      category, 
      subcategory, 
      minPrice, 
      maxPrice, 
      isBestSeller, 
      isOnSale,
      limit = 20,
      page = 1
    } = req.query;

    const query = { status: 'Active' };
    
    if (q) {
      const searchRegex = new RegExp(q, 'i');
      query.$or = [
        { name: searchRegex },
        { shortDesc: searchRegex },
        { longDesc: searchRegex }
      ];
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

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [items, total] = await Promise.all([
      Item.find(query)
        .populate('category', 'name')
        .populate('subcategory', 'name')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Item.countDocuments(query)
    ]);

    res.json({
      items,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        hasNext: skip + items.length < total,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Search customers
exports.searchCustomers = async (req, res) => {
  try {
    const { q, status, limit = 20, page = 1 } = req.query;
    
    const query = {};
    
    if (q) {
      const searchRegex = new RegExp(q, 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ];
    }
    
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [customers, total] = await Promise.all([
      User.find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      User.countDocuments(query)
    ]);

    res.json({
      customers,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Search orders
exports.searchOrders = async (req, res) => {
  try {
    const { q, status, paymentStatus, limit = 20, page = 1 } = req.query;
    
    let query = {};
    
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    let orders = await Order.find(query)
      .populate('customerId', 'name email phone')
      .populate('items.itemId', 'name price')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    if (q) {
      const searchRegex = new RegExp(q, 'i');
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
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};