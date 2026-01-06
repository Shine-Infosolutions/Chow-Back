const Order = require('../models/Order');
const { delhiveryService } = require('../services');

/**
 * Handle Delhivery webhook for shipment status updates
 * This endpoint receives status updates from Delhivery and updates order status accordingly
 */
exports.delhiveryWebhook = async (req, res) => {
  try {
    // CRITICAL FIX: Add webhook security
    const webhookSecret = process.env.DELHIVERY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const receivedSecret = req.headers['x-delhivery-signature'] || req.headers['authorization'];
      if (!receivedSecret || receivedSecret !== webhookSecret) {
        console.log('Delhivery webhook: Invalid signature');
        return res.status(401).json({ message: 'Unauthorized' });
      }
    }
    
    console.log('Delhivery webhook received:', JSON.stringify(req.body, null, 2));
    
    const { waybill, status, expected_delivery_date, current_status } = req.body;
    
    // Validate required fields
    if (!waybill) {
      console.log('Webhook missing waybill');
      return res.status(400).json({ message: 'Waybill required' });
    }

    // Find order by waybill
    const order = await Order.findOne({ waybill });
    if (!order) {
      console.log('Order not found for waybill:', waybill);
      return res.status(200).json({ message: 'Order not found' });
    }

    // CRITICAL: Block webhook updates for self-delivery orders
    if (order.deliveryProvider === 'self') {
      console.log(`BLOCKED: Webhook attempted to update self-delivery order ${order._id}`);
      return res.status(200).json({ ignored: 'Self delivery order' });
    }

    // Map Delhivery status to our internal status
    const statusToMap = current_status || status;
    const statusMap = {
      'Shipped': 'SHIPMENT_CREATED',
      'Dispatched': 'SHIPMENT_CREATED',
      'In transit': 'IN_TRANSIT',
      'In Transit': 'IN_TRANSIT',
      'Out for Delivery': 'IN_TRANSIT',
      'Out For Delivery': 'IN_TRANSIT',
      'Delivered': 'DELIVERED',
      'RTO Initiated': 'RTO',
      'RTO-Initiated': 'RTO',
      'RTO Delivered': 'RTO',
      'RTO-Delivered': 'RTO',
      'Cancelled': 'RTO',
      'Lost': 'RTO',
      'Damaged': 'RTO'
    };

    const newDeliveryStatus = statusMap[statusToMap] || order.deliveryStatus;
    
    // Only update if status has changed
    if (newDeliveryStatus !== order.deliveryStatus) {
      const oldStatus = order.deliveryStatus;
      order.deliveryStatus = newDeliveryStatus;
      
      // Update order status based on delivery status
      if (newDeliveryStatus === 'DELIVERED') {
        order.status = 'delivered';
      } else if (newDeliveryStatus === 'RTO') {
        order.status = 'cancelled';
        // Handle RTO - restock items if not already handled
        if (!order.rtoHandled) {
          await handleRTO(order);
          order.rtoHandled = true;
        }
      } else if (newDeliveryStatus === 'IN_TRANSIT' && order.status === 'confirmed') {
        order.status = 'shipped';
      }
      
      await order.save();
      console.log(`Order ${order._id} delivery status updated: ${oldStatus} → ${newDeliveryStatus}`);
    } else {
      console.log(`Order ${order._id} status unchanged: ${newDeliveryStatus}`);
    }

    res.status(200).json({ received: true, orderId: order._id });
  } catch (error) {
    console.error('Delhivery webhook error:', error);
    // Return 200 to prevent infinite retries from Delhivery
    res.status(200).json({ error: 'Internal server error' });
  }
};

// Helper function to handle RTO (Return to Origin)
const handleRTO = async (order) => {
  try {
    const Item = require('../models/Item');
    
    // Restock items
    for (const item of order.items) {
      await Item.findByIdAndUpdate(
        item.itemId,
        { $inc: { stockQty: item.quantity } }
      );
    }
    
    // Calculate RTO charges (forward + return shipping only)
    const forwardShipping = order.shipping?.total || 0;
    const rtoCharges = forwardShipping * 2; // Approximate RTO cost
    
    order.rtoCharges = rtoCharges;
    order.logisticsLoss = rtoCharges;
    
    console.log(`RTO handled for order ${order._id}: Items restocked, RTO charges: ₹${rtoCharges}`);
  } catch (error) {
    console.error('RTO handling error:', error);
  }
};

/**
 * Check pincode serviceability
 * Used during checkout to validate if delivery is available
 */
exports.checkPincode = async (req, res) => {
  try {
    const { pincode } = req.params;
    
    const result = await delhiveryService.checkPincode(pincode);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Pincode check failed'
      });
    }
    
    res.json({
      success: true,
      serviceable: result.serviceable,
      city: result.city,
      state: result.state
    });
  } catch (error) {
    console.error('Pincode check error:', error);
    res.status(500).json({ success: false, error: 'Pincode check failed' });
  }
};

/**
 * Calculate shipping rate for given parameters
 * Used during checkout to get accurate delivery charges
 */
exports.calculateRate = async (req, res) => {
  try {
    const { deliveryPincode, weight } = req.body;
    
    const result = await delhiveryService.calculateRate({
      pickupPincode: process.env.DELHIVERY_PICKUP_PIN,
      deliveryPincode,
      weight
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Rate calculation failed'
      });
    }

    res.json({
      success: true,
      rate: result.rate,
      currency: result.currency,
      breakdown: result.breakdown
    });
  } catch (error) {
    console.error('Rate calculation error:', error);
    res.status(500).json({ success: false, error: 'Rate calculation failed' });
  }
};

/**
 * Create shipment after order confirmation
 * Called automatically after payment confirmation or manually by admin
 */
exports.createShipment = async (req, res) => {
  console.log('=== CREATE SHIPMENT DEBUG START ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { orderId } = req.body;
    console.log('Extracted orderId:', orderId);
    
    if (!orderId) {
      console.log('ERROR: No orderId provided');
      return res.status(400).json({ success: false, message: 'Order ID required' });
    }
    
    console.log('Fetching order from database...');
    const order = await Order.findById(orderId)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name weight');

    console.log('Order found:', !!order);
    if (!order) {
      console.log('ERROR: Order not found for ID:', orderId);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    console.log('Order details:');
    console.log('- Order ID:', order._id);
    console.log('- Payment Status:', order.paymentStatus);
    console.log('- Current Status:', order.status);
    console.log('- Delivery Provider:', order.deliveryProvider);
    console.log('- Existing Waybill:', order.waybill);
    console.log('- User ID:', order.userId?._id);
    console.log('- Address ID:', order.addressId);

    if (order.paymentStatus !== 'paid') {
      console.log('ERROR: Order payment status is not paid:', order.paymentStatus);
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot create shipment for unpaid order' 
      });
    }

    if (order.waybill) {
      console.log('ERROR: Shipment already exists with waybill:', order.waybill);
      return res.status(400).json({ 
        success: false, 
        message: 'Shipment already created',
        waybill: order.waybill
      });
    }

    console.log('User addresses:', order.userId?.address?.length || 0);
    console.log('Looking for address ID:', order.addressId);
    
    // Get delivery address
    const deliveryAddress = order.userId?.address?.find(
      addr => String(addr._id) === String(order.addressId)
    );

    console.log('Delivery address found:', !!deliveryAddress);
    if (!deliveryAddress) {
      console.log('ERROR: Delivery address not found');
      console.log('Available addresses:', order.userId?.address?.map(a => ({ id: a._id, city: a.city })));
      return res.status(400).json({ 
        success: false, 
        message: 'Delivery address not found' 
      });
    }

    console.log('Delivery address details:');
    console.log('- Name:', `${deliveryAddress.firstName} ${deliveryAddress.lastName}`);
    console.log('- City:', deliveryAddress.city);
    console.log('- State:', deliveryAddress.state);
    console.log('- Pincode:', deliveryAddress.postcode);
    console.log('- Street:', deliveryAddress.street);

    // Prepare shipment data
    const shipmentData = {
      orderId: order._id,
      customerName: `${deliveryAddress.firstName || ''} ${deliveryAddress.lastName || ''}`.trim(),
      address: deliveryAddress.street || '',
      city: deliveryAddress.city || '',
      state: deliveryAddress.state || '',
      pincode: deliveryAddress.postcode || '',
      phone: order.userId?.phone || '',
      paymentMode: order.paymentMode || 'PREPAID',
      totalAmount: order.totalAmount / 100, // Convert from paise
      totalWeight: order.totalWeight || 500,
      totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      itemsDescription: order.items.map(item => 
        `${item.itemId?.name || 'Unknown Item'} x ${item.quantity}`
      ).join(', ')
    };

    console.log('Prepared shipment data:');
    console.log(JSON.stringify(shipmentData, null, 2));

    console.log('Calling delhiveryService.createShipment...');
    const result = await delhiveryService.createShipment(shipmentData);
    
    console.log('Delhivery service result:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('Shipment creation successful, updating order...');
      order.waybill = result.waybill;
      order.deliveryStatus = result.status;
      order.status = 'shipped';
      order.shipmentCreated = true;
      if (order.shipping) {
        order.shipping.charged = true;
      }
      await order.save();
      
      console.log(`SUCCESS: Shipment created for order ${order._id}: ${result.waybill}`);
    } else {
      console.log('ERROR: Shipment creation failed:', result.error);
    }

    const response = {
      success: result.success,
      waybill: result.waybill,
      status: result.status,
      estimatedDelivery: result.estimatedDelivery,
      error: result.error
    };
    
    console.log('Sending response:');
    console.log(JSON.stringify(response, null, 2));
    console.log('=== CREATE SHIPMENT DEBUG END ===');
    
    res.json(response);
  } catch (error) {
    console.error('=== SHIPMENT CREATION ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('=== ERROR END ===');
    res.status(500).json({ success: false, error: 'Shipment creation failed', details: error.message });
  }
};

/**
 * Get order tracking information by order ID
 * Convenience endpoint for frontend to track orders
 */
exports.trackOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findById(orderId).select('waybill deliveryStatus status');
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    if (!order.waybill) {
      return res.json({
        success: true,
        status: order.deliveryStatus,
        message: 'Shipment not yet created'
      });
    }
    
    const trackingResult = await delhiveryService.trackShipment(order.waybill);
    
    res.json({
      success: true,
      orderId,
      waybill: order.waybill,
      orderStatus: order.status,
      deliveryStatus: order.deliveryStatus,
      tracking: trackingResult.success ? trackingResult : null
    });
  } catch (error) {
    console.error('Order tracking error:', error);
    res.status(500).json({ success: false, error: 'Order tracking failed' });
  }
};

/**
 * Track shipment by waybill
 * Provides real-time tracking information for orders
 */
exports.trackShipment = async (req, res) => {
  try {
    const { waybill } = req.params;
    
    const result = await delhiveryService.trackShipment(waybill);
    
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      waybill,
      status: result.status,
      location: result.location,
      expectedDelivery: result.expectedDelivery,
      currentLocation: result.currentLocation,
      trackingHistory: result.trackingHistory
    });
  } catch (error) {
    console.error('Shipment tracking error:', error);
    res.status(500).json({ success: false, error: 'Tracking failed' });
  }
}

/**
 * Retry failed shipments
 * Manual endpoint to retry shipment creation for confirmed orders
 */
exports.retryFailedShipments = async (req, res) => {
  try {
    const { retryFailedShipments } = require('../utils');
    const result = await retryFailedShipments();
    
    res.json({
      success: true,
      message: `Processed ${result.total} orders: ${result.success} successful, ${result.failed} failed`,
      ...result
    });
  } catch (error) {
    console.error('Shipment retry error:', error);
    res.status(500).json({ success: false, error: 'Retry process failed' });
  }
};

/**
 * Get orders needing manual intervention
 */
exports.getProblematicOrders = async (req, res) => {
  try {
    const { getOrdersNeedingIntervention } = require('../utils');
    const orders = await getOrdersNeedingIntervention();
    
    res.json({
      success: true,
      count: orders.length,
      orders
    });
  } catch (error) {
    console.error('Error fetching problematic orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
};