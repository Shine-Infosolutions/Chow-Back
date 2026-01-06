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
  if (order.paymentStatus === 'paid') {
    return { success: true, message: 'Already confirmed' };
  }

  Object.assign(order, {
    paymentStatus: 'paid',
    status: 'confirmed',
    confirmedAt: new Date()
  });

  order.razorpayData.push({
    paymentId: paymentData.id,
    amount: paymentData.amount,
    status: 'paid',
    method: paymentData.method,
    source: paymentData.source || 'api',
    signatureVerified: paymentData.signatureVerified || false,
    attemptNumber: (order.razorpayData.length || 0) + 1,
    createdAt: new Date()
  });

  await order.save();

  const shouldCreateShipment = deliveryService.shouldCreateDelhiveryShipment(order);
  console.log(`Payment confirmed for ${shouldCreateShipment ? 'Delhivery' : 'local delivery'} order:`, order._id);

  return { success: true, orderId: order._id };
};

// ==================== SHIPMENT UTILITIES ====================

const createDelhiveryShipment = async (orderId) => {
  const Order = require('../models/Order');
  
  const order = await Order.findById(orderId)
    .populate('userId', 'name email phone address')
    .populate('items.itemId', 'name weight');

  if (!order || order.waybill) return;
  
  if (!deliveryService.shouldCreateDelhiveryShipment(order)) {
    console.log(`BLOCKED: Shipment creation attempted for order: ${orderId} (Provider: ${order.deliveryProvider})`);
    return;
  }

  const deliveryAddress = order.userId.address?.find(
    addr => String(addr._id) === String(order.addressId)
  );

  if (!deliveryAddress) throw new Error('Delivery address not found');

  const shipmentData = {
    orderId: order._id,
    customerName: `${deliveryAddress.firstName} ${deliveryAddress.lastName}`,
    address: deliveryAddress.street,
    city: deliveryAddress.city,
    state: deliveryAddress.state,
    pincode: deliveryAddress.postcode,
    phone: order.userId.phone,
    paymentMode: 'PREPAID',
    totalAmount: order.totalAmount,
    totalWeight: order.totalWeight,
    totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    itemsDescription: order.items.map(item => 
      `${item.itemId.name} x ${item.quantity}`
    ).join(', ')
  };

  try {
    const result = await delhiveryService.createShipment(shipmentData);
    
    if (result.success) {
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
      throw new Error(result.error || 'Shipment creation failed');
    }
  } catch (error) {
    order.shipmentAttempts = (order.shipmentAttempts || 0) + 1;
    order.shipmentLastError = error.message;
    await order.save();
    
    console.error(`Shipment creation failed for order ${orderId} (attempt ${order.shipmentAttempts}):`, error.message);
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