const Order = require('../models/Order');
const Item = require('../models/Item');

// Get all orders
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price')
      .sort({ createdAt: -1 });
    
    const ordersWithAddress = orders.map(order => ({
      ...order.toObject(),
      deliveryAddress: order.userId?.address?.id(order.addressId) || null
    }));
    
    res.json({ success: true, orders: ordersWithAddress });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price');
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const orderWithAddress = {
      ...order.toObject(),
      deliveryAddress: order.userId?.address?.id(order.addressId) || null
    };

    res.json({ success: true, order: orderWithAddress });
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

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Update stock when order is delivered
    if (status === 'delivered' && order.status !== 'delivered') {
      await Promise.all(order.items.map(async (item) => {
        if (item.itemId) {
          await Item.findByIdAndUpdate(
            item.itemId,
            { $inc: { stockQty: -item.quantity } },
            { new: true }
          ).catch(err => console.error(`Stock update failed for ${item.itemId}:`, err));
        }
      }));
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

// Get orders by user ID
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.params.userId })
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price')
      .sort({ createdAt: -1 });
    
    const ordersWithAddress = orders.map(order => ({
      ...order.toObject(),
      deliveryAddress: order.userId?.address?.id(order.addressId) || {
        _id: order.addressId,
        firstName: 'Address',
        lastName: 'Not Found',
        street: 'Address not available',
        city: 'N/A',
        state: 'N/A',
        postcode: 'N/A'
      }
    }));
    
    res.json({ success: true, orders: ordersWithAddress });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new order
exports.createOrder = async (req, res) => {
  try {
    const { userId, addressId, items, totalAmount, distance, deliveryFee } = req.body;

    if (!userId || !addressId || !items?.length || !totalAmount) {
      return res.status(400).json({ 
        success: false, 
        message: 'UserId, addressId, items, and totalAmount are required' 
      });
    }

    const orderData = { userId, addressId, items, totalAmount };
    if (distance !== undefined) orderData.distance = distance;
    if (deliveryFee !== undefined) orderData.deliveryFee = deliveryFee;

    const order = new Order(orderData);
    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price');

    const orderWithAddress = {
      ...populatedOrder.toObject(),
      deliveryAddress: populatedOrder.userId?.address?.id(addressId) || {
        _id: addressId,
        firstName: 'Address',
        lastName: 'Not Found',
        street: 'Address not available'
      }
    };

    res.status(201).json({ success: true, order: orderWithAddress });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};