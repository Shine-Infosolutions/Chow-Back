const Razorpay = require('razorpay');
const Order = require('../models/Order');
const Item = require('../models/Item');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

// Create Razorpay order and save pending order in DB
exports.createOrder = async (req, res) => {
  try {
    const { amount, currency = 'INR', orderData } = req.body;
    
    if (!orderData) {
      return res.status(400).json({ success: false, message: 'Order data is required' });
    }

    // Create Razorpay order
    const options = {
      amount: amount * 100,
      currency,
      receipt: `order_${Date.now()}`,
    };

    const razorpayOrder = await razorpay.orders.create(options);
    
    // Save pending order in database immediately
    const pendingOrder = new Order({
      userId: orderData.userId,
      addressId: orderData.addressId,
      items: orderData.items,
      totalAmount: orderData.totalAmount,
      distance: orderData.distance || 0,
      deliveryFee: orderData.deliveryFee || 0,
      status: 'failed',
      paymentStatus: 'failed',
      razorpayData: [{
        orderId: razorpayOrder.id,
        status: 'created',
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        createdAt: new Date()
      }]
    });
    
    await pendingOrder.save();
    console.log('Pending order saved with ID:', pendingOrder._id);
    
    res.json({ 
      success: true, 
      order: razorpayOrder,
      dbOrderId: pendingOrder._id
    });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ success: false, message: 'Failed to create payment order' });
  }
};

// Verify successful payment
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, dbOrderId, payment_data } = req.body;
    
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');

    const isPaymentValid = generated_signature === razorpay_signature;
    
    // Find the pending order
    const order = await Order.findById(dbOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Update order with payment details
    const existingRazorpayEntry = order.razorpayData.find(entry => entry.orderId === razorpay_order_id);
    
    if (existingRazorpayEntry) {
      // Update existing entry
      existingRazorpayEntry.paymentId = razorpay_payment_id;
      existingRazorpayEntry.signature = razorpay_signature;
      existingRazorpayEntry.status = isPaymentValid ? 'paid' : 'failed';
      existingRazorpayEntry.createdAt = new Date();
      if (payment_data) {
        Object.assign(existingRazorpayEntry, payment_data);
      }
    } else {
      // Add new entry if not found
      const paymentRecord = {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        status: isPaymentValid ? 'paid' : 'failed',
        createdAt: new Date(),
        ...payment_data
      };
      order.razorpayData.push(paymentRecord);
    }
    order.paymentStatus = isPaymentValid ? 'paid' : 'failed';
    order.status = isPaymentValid ? 'confirmed' : 'failed';
    
    await order.save();

    if (isPaymentValid) {
      // Update stock for successful payment
      await Promise.all(order.items.map(async (item) => {
        if (item.itemId) {
          await Item.findByIdAndUpdate(
            item.itemId,
            { $inc: { stockQty: -item.quantity } },
            { new: true }
          ).catch(err => console.error(`Stock update failed for ${item.itemId}:`, err));
        }
      }));
      
      res.json({ success: true, message: 'Payment verified successfully', orderId: order._id });
    } else {
      res.status(400).json({ success: false, message: 'Payment verification failed', orderId: order._id });
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
};

// Handle payment cancellation/failure
exports.handlePaymentFailure = async (req, res) => {
  try {
    const { dbOrderId, razorpay_order_id, error_reason } = req.body;
    
    // Find the pending order
    const order = await Order.findById(dbOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Update order as failed
    order.razorpayData.push({
      orderId: razorpay_order_id,
      status: 'failed',
      errorReason: error_reason || 'Payment cancelled by user',
      createdAt: new Date()
    });
    
    order.status = 'failed';
    order.paymentStatus = 'failed';
    
    await order.save();
    console.log('Order marked as failed:', order._id);
    
    res.json({ 
      success: true, 
      message: 'Order marked as failed', 
      orderId: order._id 
    });
  } catch (error) {
    console.error('Error handling payment failure:', error);
    res.status(500).json({ success: false, message: 'Failed to handle payment failure' });
  }
};

// Clean failed orders (delete old failed orders)
exports.cleanFailedOrders = async (req, res) => {
  try {
    const result = await Order.deleteMany({
      $or: [
        { status: 'failed' },
        { paymentStatus: 'failed' }
      ]
    });
    
    res.json({ 
      success: true, 
      message: `${result.deletedCount} failed orders cleaned successfully` 
    });
  } catch (error) {
    console.error('Error cleaning failed orders:', error);
    res.status(500).json({ success: false, message: 'Failed to clean failed orders' });
  }
};