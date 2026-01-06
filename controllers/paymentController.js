const crypto = require('crypto');
const Order = require('../models/Order');
const Item = require('../models/Item');
const { verifyRazorpaySignature, processPaymentConfirmation, createDelhiveryShipment } = require('../utils');
const { razorpay } = require('../config');
const { delhiveryService, deliveryService } = require('../services');
const { isGorakhpurPincode, getLocalDeliveryCharge } = require('../config/gorakhpurPincodes');

const updateStock = async (items = []) => {
  for (const i of items) {
    const item = await Item.findById(i.itemId);
    if (!item || item.stockQty < i.quantity) {
      throw new Error(`Insufficient stock for item ${i.itemId}`);
    }
    await Item.findByIdAndUpdate(
      i.itemId,
      { $inc: { stockQty: -i.quantity } }
    );
  }
};

/* -------------------- CREATE ORDER (PENDING) --------------- */
exports.createOrder = async (req, res) => {
  try {
    const { orderData } = req.body;
    
    if (!orderData || !orderData.items?.length) {
      return res.status(400).json({ success: false, message: 'Invalid order data' });
    }

    // HARD RULE: Reject any non-PREPAID payment mode
    if (orderData.paymentMode && orderData.paymentMode !== 'PREPAID') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only prepaid orders are supported' 
      });
    }

    // CRITICAL FIX: Check stock BEFORE creating Razorpay order
    for (const i of orderData.items) {
      const item = await Item.findById(i.itemId);
      if (!item || item.stockQty < i.quantity) {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient stock for item ${i.itemId}` 
        });
      }
    }

    // Calculate total weight using order method
    const tempOrder = new Order({ items: orderData.items });
    const totalWeight = tempOrder.calculateWeight();

    // Get delivery information using centralized service
    const deliveryInfo = await deliveryService.getDeliveryInfo(orderData.deliveryPincode, totalWeight);
    
    if (!deliveryInfo.serviceable) {
      return res.status(400).json({ 
        success: false, 
        message: deliveryInfo.error || 'Delivery not available to this pincode' 
      });
    }

    // Validate delivery provider selection (prevents Delhivery for Gorakhpur)
    const deliveryProvider = deliveryInfo.provider.toLowerCase();
    deliveryService.validateDeliveryProvider(orderData.deliveryPincode, deliveryProvider);
    
    const shippingTotal = deliveryInfo.charge;
    const deliveryETA = deliveryInfo.eta;

    // Server-side amount calculation
    const subtotal = orderData.items.reduce(
      (sum, i) => sum + i.price * i.quantity,
      0
    );

    const gstAmount = subtotal * 0.05; // GST only on items
    const finalAmountInRupees = Math.round((subtotal + gstAmount + shippingTotal) * 100) / 100;
    const finalAmountInPaise = Math.round(finalAmountInRupees * 100);

    // Validation: Ensure we're not storing paisa as rupees
    if (finalAmountInRupees > 100000) {
      throw new Error('Order amount seems too high - possible currency conversion error');
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: finalAmountInPaise,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`
    });

    const orderDoc = await Order.create({
      ...orderData,
      totalAmount: finalAmountInRupees,
      shipping: {
        provider: deliveryProvider,
        total: shippingTotal,
        breakdown: deliveryInfo.breakdown || { [deliveryProvider]: shippingTotal },
        eta: deliveryETA
      },
      totalWeight,
      distance: deliveryInfo.distance || 0,
      paymentMode: 'PREPAID',
      deliveryProvider,
      deliveryProviderDisplay: deliveryInfo.displayName,
      currency: 'INR',
      status: 'pending',
      paymentStatus: 'pending',
      deliveryStatus: 'PENDING',
      razorpayData: [{
        orderId: razorpayOrder.id,
        status: 'created',
        amount: razorpayOrder.amount,
        currency: 'INR',
        createdAt: new Date()
      }]
    });

    // DON'T update stock here - only after payment confirmation

    res.json({
      success: true,
      order: razorpayOrder,
      dbOrderId: orderDoc._id,
      shippingCharge: shippingTotal,
      deliveryProvider,
      deliveryProviderDisplay: deliveryInfo.displayName,
      deliveryETA
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* -------------------- VERIFY PAYMENT (UX ONLY) -------------------- */
exports.verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      dbOrderId
    } = req.body;

    const order = await Order.findById(dbOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.paymentStatus === 'paid') {
      return res.json({ success: true, orderId: order._id });
    }

    const valid = verifyRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!valid) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    // Force-check payment status after signature verification
    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    if (payment.status === "captured") {
      const result = await processPaymentConfirmation(order, {
        ...payment,
        source: 'verify_payment'
      });
      return res.json(result);
    } else {
      // Store payment ID for webhook process
      order.razorpayData.push({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        status: 'signature_verified',
        signatureVerified: true,
        createdAt: new Date()
      });
      
      await order.save();
    }

    res.json({ success: true, orderId: order._id });
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({ success: false, message: err.message || 'Payment verification failed' });
  }
};

/* -------------------- PAYMENT FAILURE -------------------- */
exports.handlePaymentFailure = async (req, res) => {
  try {
    const { dbOrderId, reason } = req.body;

    const order = await Order.findById(dbOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.paymentStatus === 'paid') {
      return res.status(400).json({ success: false, message: 'Cannot cancel - payment already processed' });
    }

    // Cancel the order regardless of current status
    order.status = 'cancelled';
    order.paymentStatus = 'cancelled';
    order.cancelledAt = new Date();
    
    // Mark shipping as not charged since payment was cancelled before completion
    if (order.shipping && !order.shipmentCreated) {
      order.shipping.charged = false;
    }
    
    order.razorpayData.push({
      status: 'cancelled',
      errorReason: reason || 'User cancelled payment',
      createdAt: new Date()
    });

    await order.save();

    res.json({ success: true, orderId: order._id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Cancellation failed' });
  }
};

/* -------------------- RAZORPAY WEBHOOK (FINAL AUTHORITY) -------------------- */
exports.razorpayWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    
    if (!secret) {
      console.log('No webhook secret configured');
      return res.status(400).json({ message: 'Webhook secret not configured' });
    }
    
    const shasum = crypto.createHmac('sha256', secret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest('hex');

    const receivedSignature = req.headers['x-razorpay-signature'];

    if (digest !== receivedSignature) {
      console.log('Signature mismatch');
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const event = req.body.event;
    const payment = req.body.payload.payment.entity;

    console.log('Processing webhook event:', event, 'for payment:', payment.id);

    const order = await Order.findOne({
      'razorpayData.orderId': payment.order_id
    });

    if (!order) {
      console.log('Order not found for Razorpay order:', payment.order_id);
      return res.status(200).json({ received: true, message: 'Order not found' });
    }

    console.log(`Found order ${order._id} with status: ${order.status}, paymentStatus: ${order.paymentStatus}`);

    // Handle different webhook events
    switch (event) {
      case 'payment.captured':
        if (order.paymentStatus === 'paid') {
          console.log('Order already confirmed, skipping');
          break;
        }
        
        console.log('Processing payment.captured for order:', order._id);
        const result = await processPaymentConfirmation(order, {
          ...payment,
          source: 'webhook'
        });
        
        if (result.success) {
          console.log('✅ Payment confirmed via webhook for order:', order._id);
        } else {
          console.log('❌ Payment confirmation failed:', result.message);
        }
        break;

      case 'payment.failed':
        console.log('Processing payment.failed for order:', order._id);
        if (order.paymentStatus !== 'paid') {
          order.paymentStatus = 'failed';
          order.status = 'failed';
          order.razorpayData.push({
            status: 'failed',
            errorReason: payment.error_description || 'Payment failed',
            source: 'webhook',
            createdAt: new Date()
          });
          await order.save();
          console.log('Order marked as failed via webhook');
        }
        break;

      case 'payment.authorized':
        console.log('Payment authorized but not captured yet for order:', order._id);
        order.razorpayData.push({
          paymentId: payment.id,
          status: 'authorized',
          amount: payment.amount,
          method: payment.method,
          source: 'webhook',
          createdAt: new Date()
        });
        await order.save();
        break;

      default:
        console.log('Unhandled webhook event:', event);
    }

    res.status(200).json({ received: true, event, orderId: order._id });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: err.message });
  }
};
/* -------------------- MANUAL PAYMENT CONFIRMATION (FOR MISSED WEBHOOKS) -------------------- */
exports.confirmPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.paymentStatus === 'paid') {
      return res.json({ success: true, message: 'Already confirmed' });
    }

    // Get payment ID from razorpayData
    const paymentData = order.razorpayData.find(d => d.paymentId);
    if (!paymentData) {
      return res.status(400).json({ success: false, message: 'No payment ID found' });
    }

    // Verify with Razorpay API
    const payment = await razorpay.payments.fetch(paymentData.paymentId);
    
    if (payment.status === 'captured') {
      const result = await processPaymentConfirmation(order, {
        ...payment,
        source: 'manual_confirmation'
      });
      return res.json(result);
    }

    res.status(400).json({ success: false, message: 'Payment not captured' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
/* -------------------- FIX INCONSISTENT ORDERS -------------------- */
exports.fixInconsistentOrders = async (req, res) => {
  try {
    // Find orders that are both cancelled and confirmed
    const inconsistentOrders = await Order.find({
      $and: [
        { cancelledAt: { $exists: true } },
        { confirmedAt: { $exists: true } }
      ]
    });

    let fixed = 0;
    for (const order of inconsistentOrders) {
      // If payment is actually captured, keep it confirmed
      if (order.paymentStatus === 'paid') {
        order.status = 'confirmed';
        order.cancelledAt = undefined;
        await order.save();
        fixed++;
      }
    }

    res.json({ success: true, fixed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.cleanFailedOrders = async (req, res) => {
  try {
    // Use the same query as getFailedOrders to ensure consistency
    const failedOrdersQuery = {
      $or: [
        { status: 'failed' },
        { status: 'cancelled' },
        { status: 'pending' },
        { paymentStatus: 'failed' }
      ]
    };

    // Find orders to be deleted first to restock items
    const ordersToDelete = await Order.find(failedOrdersQuery).populate('items.itemId');

    // Restock items for cancelled/failed orders
    for (const order of ordersToDelete) {
      if (order.items && order.items.length > 0) {
        for (const item of order.items) {
          if (item.itemId) {
            await Item.findByIdAndUpdate(
              item.itemId._id,
              { $inc: { stockQty: item.quantity } }
            );
          }
        }
      }
    }

    // Delete the orders using the same query
    const result = await Order.deleteMany(failedOrdersQuery);

    res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} failed orders and restocked ${ordersToDelete.length} orders`,
      deleted: result.deletedCount,
      restocked: ordersToDelete.length
    });
  } catch (err) {
    console.error('Clean failed orders error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

