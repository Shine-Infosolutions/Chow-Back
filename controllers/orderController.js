const Order = require('../models/Order');

// Get all orders
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().populate('customerId items.itemId');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get my orders
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ customerId: req.params.customerId }).populate('items.itemId');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create order
exports.createOrder = async (req, res) => {
  try {
    const { customerId, addressId, items, totalAmount } = req.body;
    
    if (!customerId || !addressId || !items || !totalAmount) {
      return res.status(400).json({ message: 'Customer ID, Address ID, items, and total amount are required' });
    }

    const order = new Order(req.body);
    const savedOrder = await order.save();
    res.status(201).json({ success: true, order: savedOrder });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};