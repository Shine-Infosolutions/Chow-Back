const Order = require('../models/Order');
const Item = require('../models/Item');
const { razorpay } = require('../config');

const { deriveOrderStatus, updateOrderSignals, getUpdatePermissions } = require('../utils/orderStatusDeriver');

const TAX_RATE = 0.05;

const QUERIES = {
  SUCCESS: {
    status: { $in: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] }
  },
  FAILED: {
    $or: [
      { status: 'failed' },
      { paymentStatus: 'failed' }
    ]
  }
};

const formatAddress = (address) => {
  if (!address) return 'Address not available';
  const { firstName = '', lastName = '', street = '', city = '', state = '', postcode = '' } = address;
  return `${firstName} ${lastName}, ${street}, ${city}, ${state} - ${postcode}`.trim();
};

const calculateOrderTotals = (items = [], deliveryFee = 0) => {
  const subtotal = items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
  const tax = +(subtotal * TAX_RATE).toFixed(2);
  return {
    subtotal: +subtotal.toFixed(2),
    tax,
    deliveryCharge: +deliveryFee.toFixed(2)
  };
};

const getDeliveryAddress = (order) => {
  if (!order.userId?.address || !order.addressId) return null;
  return order.userId.address.find(a => String(a._id) === String(order.addressId)) || null;
};

const formatOrderData = (order) => {
  const o = order.toObject();
  const deliveryAddress = getDeliveryAddress(o);
  const { subtotal, tax, deliveryCharge } = calculateOrderTotals(o.items, o.shipping?.total || 0);
  const latestPayment = o.razorpayData?.at(-1) || {};

  return {
    orderId: o._id,
    orderDate: o.createdAt,
    customerName: o.userId?.name || 'N/A',
    customerEmail: o.userId?.email || 'N/A',
    customerPhone: o.userId?.phone || 'N/A',
    deliveryAddress: formatAddress(deliveryAddress),
    items: o.items,
    itemsString: o.items
      .map(i => `${i.itemId?.name || 'Unknown'} (Qty: ${i.quantity}, ₹${i.price})`)
      .join(', '),
    subtotal,
    tax,
    deliveryCharge,
    totalAmount: o.totalAmount,
    orderStatus: o.status,
    paymentStatus: o.paymentStatus,
    razorpayOrderId: latestPayment.orderId || null,
    razorpayPaymentId: latestPayment.paymentId || null,
    paymentMethod: latestPayment.method || null,
    paymentAmount: latestPayment.amount ? latestPayment.amount / 100 : 0,
    deliveryProvider: o.deliveryProvider || null,
    deliveryStatus: o.deliveryStatus || null,
    shipping: o.shipping || null,
    shippingCharged: o.shipping?.charged || false,
    shippingRefunded: o.shipping?.refunded || false,
    shipmentCreated: o.shipmentCreated || false,
    totalWeight: o.totalWeight || 0,
    distance: o.distance, // No fallback - null is acceptable
    shipmentAttempts: o.shipmentAttempts || 0,
    paymentMode: o.paymentMode || null,
    rtoHandled: o.rtoHandled || false,
    deliveryDate: o.deliveryDate || null,
    contactPhone: o.contactPhone || null,
    altPhone: o.altPhone || null,
    cancelReason: o.cancelReason || null,
    refundStatus: o.refundStatus || 'none',
    isDelayed: o.isDelayed || false,
    delayReason: o.delayReason || null,
    adminNotes: o.adminNotes || null,
    confirmedAt: o.confirmedAt || null,
    waybill: o.waybill || null,
    currency: o.currency || 'INR',
    razorpayData: o.razorpayData || []
  };
};

const getOrdersWithPagination = async (query, page, limit) => {
  const skip = (page - 1) * limit;
  const populateOptions = [
    { path: 'userId', select: 'name email phone address' },
    { path: 'items.itemId', select: 'name price category subcategory' }
  ];

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate(populateOptions)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Order.countDocuments(query)
  ]);

  return {
    orders: orders.map(formatOrderData),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// REMOVED: Unsafe generic update function
// Status updates now go through safeStatusUpdate()

exports.getFailedOrders = async (req, res) => {
  try {
    const page = +req.query.page || 1;
    const limit = +req.query.limit || 10;
    const result = await getOrdersWithPagination(QUERIES.FAILED, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const page = +req.query.page || 1;
    const limit = +req.query.limit || 10;
    const result = await getOrdersWithPagination(QUERIES.SUCCESS, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price category subcategory');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const o = order.toObject();
    const deliveryAddress = getDeliveryAddress(o);
    const summary = calculateOrderTotals(o.items, o.shipping?.total || 0);

    res.json({
      success: true,
      order: {
        ...o,
        deliveryAddress,
        orderSummary: { ...summary, totalAmount: o.totalAmount },
        paymentDetails: {
          paymentStatus: o.paymentStatus,
          razorpayTransactions: o.razorpayData || []
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};



exports.updatePaymentStatus = async (req, res) => {
  try {
    const { paymentStatus } = req.body;
    if (!paymentStatus) {
      return res.status(400).json({ success: false, message: 'Payment status required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const updateFields = updateOrderSignals(order, { paymentStatus }, { source: 'ADMIN' });
    
    await Order.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    );

    res.json({ success: true, order: { ...order.toObject(), ...updateFields } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { deliveryStatus } = req.body;
    
    if (!deliveryStatus) {
      return res.status(400).json({ success: false, message: 'Delivery status required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.deliveryProvider !== 'SELF') {
      return res.status(403).json({ success: false, message: 'Cannot update delivery for provider orders' });
    }

    const updateFields = updateOrderSignals(order, { deliveryStatus }, { source: 'ADMIN' });
    
    if (deliveryStatus === 'DELIVERED') {
      updateFields.deliveredAt = new Date();
    }
    
    await Order.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    );
    
    res.json({ success: true, order: { ...order.toObject(), ...updateFields } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Add back the general status update endpoint
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Only allow status updates for SELF delivery orders
    if (order.deliveryProvider !== 'SELF') {
      return res.status(403).json({ success: false, message: 'Status updates only allowed for SELF delivery orders' });
    }

    // Map order status to delivery status for SELF orders
    let updates = {};
    switch (status.toLowerCase()) {
      case 'pending':
        updates.deliveryStatus = 'PENDING';
        updates.paymentStatus = 'pending';
        break;
      case 'confirmed':
        updates.deliveryStatus = 'PENDING'; // Keep delivery pending
        updates.paymentStatus = 'paid'; // Ensure payment is paid
        break;
      case 'shipped':
        updates.deliveryStatus = 'OUT_FOR_DELIVERY';
        break;
      case 'delivered':
        updates.deliveryStatus = 'DELIVERED';
        break;
      case 'cancelled':
        updates.deliveryStatus = 'PRE_PICKUP_CANCEL';
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const updateFields = updateOrderSignals(order, updates, { source: 'ADMIN' });
    
    await Order.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    );
    
    res.json({ success: true, order: { ...order.toObject(), ...updateFields } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ADMIN API: Bulk update (SELF delivery only)
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { orderIds, deliveryStatus } = req.body;
    if (!orderIds?.length || !deliveryStatus) {
      return res.status(400).json({ success: false, message: 'Order IDs and deliveryStatus required' });
    }

    const orders = await Order.find({ 
      _id: { $in: orderIds },
      deliveryProvider: 'SELF' // Only SELF delivery allowed
    });

    const updates = [];
    for (const order of orders) {
      const updateFields = updateOrderSignals(order, { deliveryStatus }, { source: 'ADMIN' });
      updates.push({
        updateOne: {
          filter: { _id: order._id },
          update: updateFields
        }
      });
    }

    if (updates.length > 0) {
      await Order.bulkWrite(updates);
    }

    res.json({ success: true, updated: updates.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};



exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      userId: req.params.userId,
      ...QUERIES.SUCCESS
    })
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price images')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      orders: orders.map(o => ({
        ...o.toObject(),
        deliveryAddress: getDeliveryAddress(o.toObject())
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getOrderPermissions = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const permissions = getUpdatePermissions(order.deliveryProvider, 'ADMIN');
    res.json({
      success: true,
      permissions,
      deliveryProvider: order.deliveryProvider
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Customer: update contact number(s) on their own order (until it's delivered/cancelled)
exports.updateOrderContact = async (req, res) => {
  try {
    const { contactPhone, altPhone } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const isOwner = String(order.userId) === String(req.user._id);
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to update this order' });
    }

    const locked = ['delivered', 'cancelled', 'failed'].includes(order.status)
      || ['DELIVERED', 'RTO', 'PRE_PICKUP_CANCEL'].includes(order.deliveryStatus);
    if (locked) {
      return res.status(400).json({ success: false, message: 'Contact can no longer be updated for this order' });
    }

    const phoneRe = /^[0-9]{10}$/;
    if (contactPhone !== undefined) {
      if (contactPhone && !phoneRe.test(contactPhone)) {
        return res.status(400).json({ success: false, message: 'Enter a valid 10-digit contact number' });
      }
      order.contactPhone = contactPhone;
    }
    if (altPhone !== undefined) {
      if (altPhone && !phoneRe.test(altPhone)) {
        return res.status(400).json({ success: false, message: 'Enter a valid 10-digit alternate number' });
      }
      order.altPhone = altPhone;
    }

    await order.save();
    res.json({ success: true, contactPhone: order.contactPhone, altPhone: order.altPhone });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Admin: cancel an order — restocks items (if paid) and records reason + refund state
exports.cancelOrder = async (req, res) => {
  try {
    const { reason, refund } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Order is already cancelled' });
    }
    if (order.status === 'delivered' || order.deliveryStatus === 'DELIVERED') {
      return res.status(400).json({ success: false, message: 'A delivered order cannot be cancelled' });
    }

    // Restock items if stock was deducted (on paid orders) and not already restored
    if (order.paymentStatus === 'paid' && !order.stockRestored) {
      for (const it of order.items) {
        await Item.findByIdAndUpdate(it.itemId, { $inc: { stockQty: it.quantity } });
      }
      order.stockRestored = true;
    }

    order.status = 'cancelled';
    order.deliveryStatus = 'PRE_PICKUP_CANCEL';
    order.cancelledAt = new Date();
    if (reason) order.cancelReason = reason;

    // Refund handling.
    //  refund === 'auto'   -> call Razorpay refund API on the captured payment
    //  refund === 'manual' -> mark refunded (handled outside, e.g. cash/UPI)
    //  refund === 'none'   -> no refund
    if (order.paymentStatus === 'paid' && refund === 'auto') {
      const paid = [...(order.razorpayData || [])].reverse().find(p => p.paymentId);
      if (razorpay && paid?.paymentId) {
        try {
          await razorpay.payments.refund(paid.paymentId, { speed: 'normal' });
          order.refundStatus = 'processed';
        } catch (e) {
          console.error('Razorpay refund failed:', e?.error?.description || e.message);
          order.refundStatus = 'pending'; // auto-refund failed — settle from dashboard
        }
      } else {
        order.refundStatus = 'pending'; // no captured payment found — handle manually
      }
    } else if (refund === 'manual') {
      order.refundStatus = 'processed';
    } else if (refund === 'none') {
      order.refundStatus = 'none';
    } else {
      order.refundStatus = order.paymentStatus === 'paid' ? 'pending' : 'none';
    }

    await order.save();
    res.json({
      success: true,
      order: {
        _id: order._id,
        status: order.status,
        deliveryStatus: order.deliveryStatus,
        cancelReason: order.cancelReason,
        refundStatus: order.refundStatus,
        stockRestored: order.stockRestored,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Admin: flag an order as delayed and optionally reschedule its delivery date
exports.markDelayed = async (req, res) => {
  try {
    const { isDelayed, delayReason, deliveryDate } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.isDelayed = isDelayed === undefined ? true : !!isDelayed;
    if (delayReason !== undefined) order.delayReason = delayReason;
    if (deliveryDate) {
      const d = new Date(deliveryDate);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid delivery date' });
      }
      order.deliveryDate = d;
    }

    await order.save();
    res.json({
      success: true,
      order: { _id: order._id, isDelayed: order.isDelayed, delayReason: order.delayReason, deliveryDate: order.deliveryDate },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Admin: internal notes on an order
exports.updateAdminNotes = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    order.adminNotes = req.body.adminNotes || '';
    await order.save();
    res.json({ success: true, adminNotes: order.adminNotes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Admin: set the delivery date after accepting an order
exports.updateDeliveryDate = async (req, res) => {
  try {
    const { deliveryDate } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (deliveryDate) {
      const d = new Date(deliveryDate);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid delivery date' });
      }
      order.deliveryDate = d;
    } else {
      order.deliveryDate = undefined;
    }

    await order.save();
    res.json({ success: true, deliveryDate: order.deliveryDate });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/* -------------------- INVOICE (printable / shareable HTML) -------------------- */
exports.getInvoice = async (req, res) => {
  try {
    const { renderInvoiceHtml } = require('../utils/invoice');
    const order = await Order.findById(req.params.id)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price');

    if (!order) {
      return res.status(404).send('<h1 style="font-family:sans-serif;text-align:center;margin-top:40px;">Invoice not found</h1>');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderInvoiceHtml(order));
  } catch (err) {
    res.status(500).send('Failed to generate invoice');
  }
};

/* -------------------- SEND / RESEND ORDER CONFIRMATION EMAIL (admin) -------------------- */
exports.sendConfirmation = async (req, res) => {
  try {
    const { sendOrderConfirmationEmail } = require('../services/mailer');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await sendOrderConfirmationEmail(req.params.id, { baseUrl });

    if (result.success) {
      return res.json({ success: true, message: 'Confirmation email sent.' });
    }
    return res.status(400).json({
      success: false,
      message: result.skipped
        ? 'Email is not configured on the server.'
        : result.error || 'Failed to send email.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

