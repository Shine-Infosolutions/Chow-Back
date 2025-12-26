const Order = require('../models/Order');
const Item = require('../models/Item');

const TAX_RATE = 0.05;
const FAILED_ORDER_QUERY = { $or: [{ status: 'failed' }, { paymentStatus: 'failed' }] };
const SUCCESS_ORDER_QUERY = { status: { $ne: 'failed' }, paymentStatus: { $ne: 'failed' } };

const formatAddress = (address) => {
  if (!address) return '';
  const { firstName = '', lastName = '', street = '', city = '', state = '', postcode = '' } = address;
  return `${firstName} ${lastName}, ${street}, ${city}, ${state} - ${postcode}`.trim();
};

const calculateOrderTotals = (items, deliveryFee = 0) => {
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(subtotal * TAX_RATE * 100) / 100,
    deliveryCharge: deliveryFee
  };
};

const formatOrderData = (order) => {
  const orderObj = order.toObject();
  const deliveryAddress = orderObj.userId?.address?.find(addr => 
    addr._id.toString() === orderObj.addressId.toString()
  ) || {};
  
  const { subtotal, tax, deliveryCharge } = calculateOrderTotals(orderObj.items, orderObj.deliveryFee);
  const latestPayment = orderObj.razorpayData?.[orderObj.razorpayData.length - 1] || {};
  
  return {
    orderId: orderObj._id,
    orderDate: orderObj.createdAt,
    customerName: orderObj.userId?.name || 'N/A',
    customerEmail: orderObj.userId?.email || 'N/A',
    customerPhone: orderObj.userId?.phone || 'N/A',
    deliveryAddress: formatAddress(deliveryAddress),
    items: orderObj.items,
    itemsString: orderObj.items.map(item => 
      `${item.itemId?.name || 'Unknown'} (Qty: ${item.quantity}, Price: ₹${item.price})`
    ).join(', '),
    subtotal,
    tax,
    deliveryCharge,
    totalAmount: orderObj.totalAmount,
    orderStatus: orderObj.status,
    paymentStatus: orderObj.paymentStatus,
    razorpayData: orderObj.razorpayData || [],
    razorpayOrderId: latestPayment.orderId || 'N/A',
    razorpayPaymentId: latestPayment.paymentId || 'N/A',
    paymentMethod: latestPayment.method || 'N/A',
    paymentBank: latestPayment.bank || 'N/A',
    paymentAmount: latestPayment.amount ? (latestPayment.amount / 100) : 0,
    paymentFee: latestPayment.fee || 0,
    paymentTax: latestPayment.tax || 0,
    paymentDate: latestPayment.createdAt || null,
    distance: orderObj.distance || 0
  };
};

const getOrdersWithPagination = async (query, page, limit) => {
  const skip = (page - 1) * limit;
  
  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price category subcategory')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Order.countDocuments(query)
  ]);
  
  return {
    orders: orders.map(formatOrderData),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  };
};

// Get failed orders
exports.getFailedOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    const result = await getOrdersWithPagination(FAILED_ORDER_QUERY, page, limit);
    res.json({ success: true, orders: result.orders, pagination: result.pagination });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all orders (excluding failed orders)
exports.getAllOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    const result = await getOrdersWithPagination(SUCCESS_ORDER_QUERY, page, limit);
    res.json({ success: true, orders: result.orders, pagination: result.pagination });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price category subcategory');
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const orderObj = order.toObject();
    const deliveryAddress = orderObj.userId?.address?.find(addr => 
      addr._id.toString() === orderObj.addressId.toString()
    ) || null;
    
    const { subtotal, tax, deliveryCharge } = calculateOrderTotals(orderObj.items, orderObj.deliveryFee);
    
    const orderWithDetails = {
      ...orderObj,
      deliveryAddress,
      orderSummary: { subtotal, tax, deliveryCharge, totalAmount: orderObj.totalAmount },
      itemDetails: orderObj.items.map(item => ({
        itemName: item.itemId?.name || 'Item not found',
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
        category: item.itemId?.category,
        subcategory: item.itemId?.subcategory
      })),
      paymentDetails: {
        paymentStatus: orderObj.paymentStatus,
        razorpayTransactions: orderObj.razorpayData || []
      }
    };

    res.json({ success: true, order: orderWithDetails });
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

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('userId', 'name email phone').populate('items.itemId', 'name price');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, message: 'Order status updated successfully', order });
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

// Get orders by user ID (excluding failed orders)
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ 
      userId: req.params.userId,
      ...SUCCESS_ORDER_QUERY
    })
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

// Create new order (deprecated)
exports.createOrder = (req, res) => {
  res.status(400).json({ 
    success: false, 
    message: 'Please use /api/payment/create-order endpoint for creating orders' 
  });
};