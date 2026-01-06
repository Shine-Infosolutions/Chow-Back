const crypto = require("crypto");
const { delhiveryService, deliveryService } = require('../services');

// ==================== PAYMENT UTILITIES ====================

const verifyRazorpaySignature = (orderId, paymentId, signature) => {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === signature;
};

const processPaymentConfirmation = async (order, paymentData) => {
  try {
    if (order.paymentStatus === 'paid') {
      return { success: true, message: 'Already confirmed' };
    }

    // Prevent confirmation of cancelled orders
    if (order.paymentStatus === 'cancelled' || order.status === 'cancelled') {
      return { success: false, message: 'Cannot confirm payment for cancelled order' };
    }

    // Update stock only after successful payment
    const Item = require('../models/Item');
    for (const item of order.items) {
      await Item.findByIdAndUpdate(
        item.itemId,
        { $inc: { stockQty: -item.quantity } }
      );
    }

    Object.assign(order, {
      paymentStatus: 'paid',
      status: 'confirmed',
      confirmedAt: new Date(),
      cancelledAt: undefined // Clear cancelled timestamp
    });

    order.razorpayData.push({
      paymentId: paymentData.id,
      amount: paymentData.amount,
      status: 'paid',
      method: paymentData.method,
      source: paymentData.source || 'api',
      signatureVerified: true,
      attemptNumber: (order.razorpayData.length || 0) + 1,
      createdAt: new Date()
    });

    await order.save();

    const shouldCreateShipment = deliveryService.shouldCreateDelhiveryShipment(order);
    console.log(`Payment confirmed for ${shouldCreateShipment ? 'Delhivery' : 'local delivery'} order:`, order._id);

    // Only create shipment for Delhivery orders
    if (shouldCreateShipment) {
      try {
        await createDelhiveryShipment(order._id);
        console.log('Shipment creation initiated for order:', order._id);
      } catch (shipmentError) {
        console.error('Shipment creation failed:', shipmentError.message);
        // Don't fail the payment confirmation if shipment creation fails
      }
    }

    return { success: true, orderId: order._id };
  } catch (error) {
    console.error('Payment confirmation error:', error);
    throw error;
  }
};

// ==================== SHIPMENT UTILITIES ====================

const createDelhiveryShipment = async (orderId) => {
  try {
    const Order = require('../models/Order');
    
    const order = await Order.findById(orderId)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name weight');

    if (!order) {
      throw new Error('Order not found');
    }
    
    if (order.waybill) {
      console.log('Order already has waybill:', order.waybill);
      return;
    }
    
    const shouldCreate = deliveryService.shouldCreateDelhiveryShipment(order);
    
    if (!shouldCreate) {
      console.log(`BLOCKED: Shipment creation attempted for order: ${orderId} (Provider: ${order.deliveryProvider})`);
      return;
    }

    if (!order.userId || !order.userId.address) {
      throw new Error('User or address data not found');
    }
    
    const deliveryAddress = order.userId.address.find(
      addr => String(addr._id) === String(order.addressId)
    );

    if (!deliveryAddress) {
      throw new Error('Delivery address not found');
    }

    const shipmentData = {
      orderId: order._id,
      customerName: `${deliveryAddress.firstName || ''} ${deliveryAddress.lastName || ''}`.trim(),
      address: deliveryAddress.street || '',
      city: deliveryAddress.city || '',
      state: deliveryAddress.state || '',
      pincode: deliveryAddress.postcode || '',
      phone: order.userId.phone || '',
      paymentMode: 'PREPAID',
      totalAmount: order.totalAmount || 0,
      totalWeight: order.totalWeight || 500,
      totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      itemsDescription: order.items.map(item => 
        `${item.itemId?.name || 'Unknown Item'} x ${item.quantity}`
      ).join(', ')
    };
    
    if (!delhiveryService || typeof delhiveryService.createShipment !== 'function') {
      throw new Error('Delhivery service not available');
    }

    const result = await delhiveryService.createShipment(shipmentData);
    
    if (!result) {
      throw new Error('Delhivery service returned no result');
    }
    
    if (result && result.success) {
      Object.assign(order, {
        waybill: result.waybill,
        deliveryStatus: result.status,
        status: 'shipped',
        shipmentAttempts: (order.shipmentAttempts || 0) + 1,
        shipmentLastError: null
      });
      await order.save();
      return result;
    } else {
      throw new Error(result?.error || 'Shipment creation failed - no result');
    }
  } catch (error) {
    console.error(`Shipment creation failed for order ${orderId}:`, error.message);
    
    // Update order with error info
    try {
      const Order = require('../models/Order');
      const order = await Order.findById(orderId);
      if (order) {
        order.shipmentAttempts = (order.shipmentAttempts || 0) + 1;
        order.shipmentLastError = error.message;
        await order.save();
      }
    } catch (saveError) {
      console.error('Failed to save shipment error:', saveError.message);
    }
    
    throw error;
  }
};

const retryFailedShipments = async (maxAttempts = 3) => {
  try {
    const Order = require('../models/Order');
    const failedOrders = await Order.find({
      paymentStatus: 'paid',
      status: 'confirmed',
      waybill: { $exists: false },
      $or: [
        { shipmentAttempts: { $lt: maxAttempts } },
        { shipmentAttempts: { $exists: false } }
      ]
    });

    console.log(`Found ${failedOrders.length} orders needing shipment creation`);

    const results = await Promise.allSettled(
      failedOrders.map(async (order) => {
        await createDelhiveryShipment(order._id);
        return order._id;
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failCount = results.filter(r => r.status === 'rejected').length;

    results.forEach((result, index) => {
      const orderId = failedOrders[index]._id;
      if (result.status === 'fulfilled') {
        console.log(`✅ Shipment created for order ${orderId}`);
      } else {
        console.log(`❌ Failed to create shipment for order ${orderId}: ${result.reason?.message}`);
      }
    });

    return {
      total: failedOrders.length,
      success: successCount,
      failed: failCount
    };
  } catch (error) {
    console.error('Shipment retry process failed:', error);
    throw error;
  }
};

const getOrdersNeedingIntervention = async (maxAttempts = 3) => {
  const Order = require('../models/Order');
  return await Order.find({
    paymentStatus: 'paid',
    status: 'confirmed',
    waybill: { $exists: false },
    shipmentAttempts: { $gte: maxAttempts }
  }).select('_id shipmentAttempts shipmentLastError totalAmount createdAt');
};

module.exports = {
  // Payment utilities
  verifyRazorpaySignature,
  processPaymentConfirmation,
  // Shipment utilities
  createDelhiveryShipment,
  retryFailedShipments,
  getOrdersNeedingIntervention
};