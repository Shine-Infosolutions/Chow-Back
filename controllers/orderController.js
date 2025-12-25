const Order = require('../models/Order');
const Item = require('../models/Item');

// Get failed orders
exports.getFailedOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const failedOrders = await Order.find({
      $or: [
        { status: 'failed' },
        { paymentStatus: 'failed' }
      ]
    })
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price category subcategory')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Order.countDocuments({
      $or: [
        { status: 'failed' },
        { paymentStatus: 'failed' }
      ]
    });
    
    const tableData = [];
    
    failedOrders.forEach(order => {
      const orderObj = order.toObject();
      
      // Find delivery address
      const deliveryAddress = orderObj.userId?.address?.find(addr => 
        addr._id.toString() === orderObj.addressId.toString()
      ) || {};
      
      // Calculate totals
      const subtotal = orderObj.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const tax = Math.round(subtotal * 0.05 * 100) / 100;
      const deliveryCharge = orderObj.deliveryFee || 0;
      
      // Get payment info
      const latestPayment = orderObj.razorpayData?.[orderObj.razorpayData.length - 1] || {};
      
      // Create one row per order with all details
      tableData.push({
        orderId: orderObj._id,
        orderDate: orderObj.createdAt,
        customerName: orderObj.userId?.name || 'N/A',
        customerEmail: orderObj.userId?.email || 'N/A',
        customerPhone: orderObj.userId?.phone || 'N/A',
        
        // Address details
        deliveryAddress: `${deliveryAddress.firstName || ''} ${deliveryAddress.lastName || ''}, ${deliveryAddress.street || ''}, ${deliveryAddress.city || ''}, ${deliveryAddress.state || ''} - ${deliveryAddress.postcode || ''}`.trim(),
        
        // Items (both formats)
        items: orderObj.items,
        itemsString: orderObj.items.map(item => 
          `${item.itemId?.name || 'Unknown'} (Qty: ${item.quantity}, Price: ₹${item.price})`
        ).join(', '),
        
        // Order totals
        subtotal: subtotal,
        tax: tax,
        deliveryCharge: deliveryCharge,
        totalAmount: orderObj.totalAmount,
        
        // Order status
        orderStatus: orderObj.status,
        paymentStatus: orderObj.paymentStatus,
        
        // Complete Razorpay data array
        razorpayData: orderObj.razorpayData || [],
        
        // Individual Razorpay details (for backward compatibility)
        razorpayOrderId: latestPayment.orderId || 'N/A',
        razorpayPaymentId: latestPayment.paymentId || 'N/A',
        paymentMethod: latestPayment.method || 'N/A',
        paymentBank: latestPayment.bank || 'N/A',
        paymentAmount: latestPayment.amount ? (latestPayment.amount / 100) : 0,
        paymentFee: latestPayment.fee || 0,
        paymentTax: latestPayment.tax || 0,
        paymentDate: latestPayment.createdAt || null,
        
        // Distance
        distance: orderObj.distance || 0
      });
    });
    
    res.json({ 
      success: true, 
      orders: tableData,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all orders (excluding failed orders)
exports.getAllOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await Order.find({
      status: { $ne: 'failed' },
      paymentStatus: { $ne: 'failed' }
    })
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price category subcategory')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Order.countDocuments({
      status: { $ne: 'failed' },
      paymentStatus: { $ne: 'failed' }
    });
    
    const tableData = [];
    
    orders.forEach(order => {
      const orderObj = order.toObject();
      
      // Find delivery address
      const deliveryAddress = orderObj.userId?.address?.find(addr => 
        addr._id.toString() === orderObj.addressId.toString()
      ) || {};
      
      // Calculate totals
      const subtotal = orderObj.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const tax = Math.round(subtotal * 0.05 * 100) / 100;
      const deliveryCharge = orderObj.deliveryFee || 0;
      
      // Get payment info
      const latestPayment = orderObj.razorpayData?.[orderObj.razorpayData.length - 1] || {};
      
      // Create one row per order with all details
      tableData.push({
        orderId: orderObj._id,
        orderDate: orderObj.createdAt,
        customerName: orderObj.userId?.name || 'N/A',
        customerEmail: orderObj.userId?.email || 'N/A',
        customerPhone: orderObj.userId?.phone || 'N/A',
        
        // Address details
        deliveryAddress: `${deliveryAddress.firstName || ''} ${deliveryAddress.lastName || ''}, ${deliveryAddress.street || ''}, ${deliveryAddress.city || ''}, ${deliveryAddress.state || ''} - ${deliveryAddress.postcode || ''}`.trim(),
        
        // Items (both formats)
        items: orderObj.items,
        itemsString: orderObj.items.map(item => 
          `${item.itemId?.name || 'Unknown'} (Qty: ${item.quantity}, Price: ₹${item.price})`
        ).join(', '),
        
        // Order totals
        subtotal: Math.round(subtotal * 100) / 100,
        tax: tax,
        deliveryCharge: deliveryCharge,
        totalAmount: orderObj.totalAmount,
        
        // Order status
        orderStatus: orderObj.status,
        paymentStatus: orderObj.paymentStatus,
        
        // Complete Razorpay data array
        razorpayData: orderObj.razorpayData || [],
        
        // Individual Razorpay details (for backward compatibility)
        razorpayOrderId: latestPayment.orderId || 'N/A',
        razorpayPaymentId: latestPayment.paymentId || 'N/A',
        paymentMethod: latestPayment.method || 'N/A',
        paymentBank: latestPayment.bank || 'N/A',
        paymentAmount: latestPayment.amount ? (latestPayment.amount / 100) : 0,
        paymentFee: latestPayment.fee || 0,
        paymentTax: latestPayment.tax || 0,
        paymentDate: latestPayment.createdAt || null,
        
        // Distance
        distance: orderObj.distance || 0
      });
    });
    
    res.json({ 
      success: true, 
      orders: tableData,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
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
    
    // Find delivery address
    const deliveryAddress = orderObj.userId?.address?.find(addr => 
      addr._id.toString() === orderObj.addressId.toString()
    ) || null;
    
    // Calculate subtotal, tax, and other details
    const subtotal = orderObj.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.05; // 5% tax
    const deliveryCharge = orderObj.deliveryFee || 0;
    
    const orderWithDetails = {
      ...orderObj,
      deliveryAddress,
      orderSummary: {
        subtotal,
        tax,
        deliveryCharge,
        totalAmount: orderObj.totalAmount
      },
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

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
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

// Get orders by user ID (excluding failed orders)
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ 
      userId: req.params.userId,
      status: { $ne: 'failed' },
      paymentStatus: { $ne: 'failed' }
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

// Create new order (deprecated - use payment/create-order instead)
exports.createOrder = async (req, res) => {
  try {
    res.status(400).json({ 
      success: false, 
      message: 'Please use /api/payment/create-order endpoint for creating orders' 
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};