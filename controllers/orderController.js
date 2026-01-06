const Order = require('../models/Order');

const TAX_RATE = 0.05;

const QUERIES = {
  SUCCESS: {
    status: { $in: ['confirmed', 'shipped', 'delivered'] },
    paymentStatus: 'paid'
  },
  FAILED: {
    $or: [
      { status: 'failed' },
      { status: 'cancelled' },
      { status: 'pending' },
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
    distance: o.distance || 0,
    shipmentAttempts: o.shipmentAttempts || 0,
    paymentMode: o.paymentMode || null,
    rtoHandled: o.rtoHandled || false,
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

const handleOrderUpdate = async (req, res, updateField) => {
  try {
    const updateValue = req.body[updateField];
    if (!updateValue) {
      return res.status(400).json({ 
        success: false, 
        message: `${updateField.charAt(0).toUpperCase() + updateField.slice(1)} required` 
      });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { [updateField]: updateValue },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

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

exports.updateOrderStatus = (req, res) => handleOrderUpdate(req, res, 'status');
exports.updatePaymentStatus = (req, res) => handleOrderUpdate(req, res, 'paymentStatus');

// Manual delivery status update for self-delivery orders
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

    // Only allow manual updates for self-delivery orders
    if (order.deliveryProvider !== 'self') {
      return res.status(400).json({ 
        success: false, 
        message: 'Manual delivery status updates only allowed for self-delivery orders' 
      });
    }

    order.deliveryStatus = deliveryStatus;
    
    // Auto-update order status based on delivery status
    if (deliveryStatus === 'DELIVERED') {
      order.status = 'delivered';
    } else if (deliveryStatus === 'IN_TRANSIT') {
      order.status = 'shipped';
    }
    
    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Bulk status update
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { orderIds, status } = req.body;
    if (!orderIds?.length || !status) {
      return res.status(400).json({ success: false, message: 'Order IDs and status required' });
    }

    const result = await Order.updateMany(
      { _id: { $in: orderIds } },
      { status, ...(status === 'delivered' && { deliveryStatus: 'DELIVERED' }) },
      { runValidators: true }
    );

    res.json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Status transition validation
exports.validateStatusTransition = async (req, res) => {
  try {
    const { currentStatus, newStatus } = req.query;
    const validTransitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['shipped', 'delivered', 'cancelled'],
      shipped: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
      failed: ['pending']
    };

    const isValid = validTransitions[currentStatus]?.includes(newStatus);
    res.json({ success: true, valid: isValid });
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
      .populate('items.itemId', 'name price')
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

