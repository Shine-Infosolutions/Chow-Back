const Order = require('../models/Order');

// Get all orders
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().populate('userId', 'name email phone').populate('items.itemId', 'name price');
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('userId', 'name email phone').populate('items.itemId', 'name price');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update order status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Update stock when order is delivered
    if (status === 'delivered' && order.status !== 'delivered') {
      const Item = require('../models/Item');
      for (const item of order.items) {
        await Item.findByIdAndUpdate(
          item.itemId,
          { $inc: { stockQty: -item.quantity } }
        );
      }
    }

    order.status = status;
    await order.save();

    const updatedOrder = await Order.findById(order._id)
      .populate('userId', 'name email phone')
      .populate('items.itemId', 'name price');

    res.json({ success: true, message: 'Order status updated successfully', order: updatedOrder });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update payment status
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { paymentStatus } = req.body;
    
    if (!paymentStatus) {
      return res.status(400).json({ success: false, message: 'Payment status is required' });
    }

    const validPaymentStatuses = ['pending', 'paid', 'failed'];
    if (!validPaymentStatuses.includes(paymentStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid payment status' });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { paymentStatus },
      { new: true, runValidators: true }
    ).populate('userId', 'name email phone').populate('items.itemId', 'name price');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, message: 'Payment status updated successfully', order });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update both order and payment status
exports.updateOrderAndPaymentStatus = async (req, res) => {
  try {
    const { status, paymentStatus } = req.body;
    const updateData = {};

    if (status) {
      const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
      }
      updateData.status = status;
    }

    if (paymentStatus) {
      const validPaymentStatuses = ['pending', 'paid', 'failed'];
      if (!validPaymentStatuses.includes(paymentStatus)) {
        return res.status(400).json({ success: false, message: 'Invalid payment status' });
      }
      updateData.paymentStatus = paymentStatus;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: 'At least one status field is required' });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('userId', 'name email phone').populate('items.itemId', 'name price');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, message: 'Order updated successfully', order });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get orders by user ID
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.params.userId })
      .populate('userId', 'name email phone')
      .populate('items.itemId', 'name price')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new order
exports.createOrder = async (req, res) => {
  try {
    const { userId, addressId, items, totalAmount } = req.body;

    if (!userId || !addressId || !items || !totalAmount) {
      return res.status(400).json({ success: false, message: 'UserId, addressId, items, and totalAmount are required' });
    }

    const order = new Order({ userId, addressId, items, totalAmount });
    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('userId', 'name email phone')
      .populate('items.itemId', 'name price');

    res.status(201).json({ success: true, order: populatedOrder });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};