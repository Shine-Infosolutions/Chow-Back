const Order = require('../models/Order');
const { delhiveryService } = require('../services');
const { updateOrderSignals } = require('../utils/orderStatusDeriver');

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

    // CRITICAL: Block webhook updates for SELF delivery orders
    if (order.deliveryProvider === 'SELF') {
      console.log(`BLOCKED: Webhook attempted to update SELF delivery order ${order._id}`);
      return res.status(200).json({ ignored: 'Self delivery order' });
    }

    // Map Delhivery status to our internal status
    const statusToMap = current_status || status;
    const statusMap = {
      'Shipped': 'SHIPMENT_CREATED',
      'Dispatched': 'SHIPMENT_CREATED',
      'In transit': 'IN_TRANSIT',
      'In Transit': 'IN_TRANSIT',
      'Out for Delivery': 'OUT_FOR_DELIVERY',
      'Out For Delivery': 'OUT_FOR_DELIVERY',
      'Delivered': 'DELIVERED',
      'RTO Initiated': 'RTO',
      'RTO-Initiated': 'RTO',
      'RTO Delivered': 'RTO',
      'RTO-Delivered': 'RTO',
      'Cancelled': 'PRE_PICKUP_CANCEL', // Distinguish from post-pickup RTO
      'Lost': 'RTO',
      'Damaged': 'RTO'
    };

    const newDeliveryStatus = statusMap[statusToMap];
    
    // Only update if we have a valid mapping and status has changed
    if (newDeliveryStatus && newDeliveryStatus !== order.deliveryStatus) {
      const oldStatus = order.deliveryStatus;
      
      // Handle RTO and cancellations atomically
      if (newDeliveryStatus === 'RTO') {
        await handleRTOAtomic(order._id);
      } else if (newDeliveryStatus === 'PRE_PICKUP_CANCEL') {
        await handlePrePickupCancelAtomic(order._id);
      }
      
      // Use updateOrderSignals with WEBHOOK source
      const updateFields = updateOrderSignals(order, { deliveryStatus: newDeliveryStatus }, { source: 'WEBHOOK' });
      
      await Order.findByIdAndUpdate(
        order._id,
        updateFields,
        { new: true, runValidators: true }
      );
      
      console.log(`Order ${order._id} delivery status updated: ${oldStatus} → ${newDeliveryStatus}, status: ${updateFields.status}`);
    } else {
      console.log(`Order ${order._id} status unchanged or invalid mapping: ${statusToMap}`);
    }

    res.status(200).json({ received: true, orderId: order._id });
  } catch (error) {
    console.error('Delhivery webhook error:', error);
    // Return 200 to prevent infinite retries from Delhivery
    res.status(200).json({ error: 'Internal server error' });
  }
};

// Atomic pre-pickup cancel handler - no RTO costs
const handlePrePickupCancelAtomic = async (orderId) => {
  try {
    const Item = require('../models/Item');
    
    // Atomic update: only process if not already handled
    const order = await Order.findOneAndUpdate(
      { 
        _id: orderId, 
        cancelHandled: { $ne: true }
      },
      { 
        $set: { cancelHandled: true }
      },
      { new: true }
    );
    
    if (!order) {
      console.log(`Cancel already handled or order not found: ${orderId}`);
      return;
    }
    
    // Restock items (no shipping costs since never picked up)
    const restockPromises = order.items.map(item => 
      Item.findByIdAndUpdate(
        item.itemId,
        { $inc: { stockQty: item.quantity } }
      )
    );
    
    await Promise.all(restockPromises);
    
    console.log(`Pre-pickup cancel handled for order ${orderId}: Items restocked, no RTO charges`);
  } catch (error) {
    console.error('Pre-pickup cancel handling error:', error);
  }
};

// Atomic RTO handler - prevents race conditions
const handleRTOAtomic = async (orderId) => {
  try {
    const Item = require('../models/Item');
    
    // Atomic update: only process RTO if not already handled
    const order = await Order.findOneAndUpdate(
      { 
        _id: orderId, 
        rtoHandled: { $ne: true } // Only if not already handled
      },
      { 
        $set: { rtoHandled: true }
      },
      { new: true }
    );
    
    // If order not found or already handled, skip
    if (!order) {
      console.log(`RTO already handled or order not found: ${orderId}`);
      return;
    }
    
    // Restock items atomically
    const restockPromises = order.items.map(item => 
      Item.findByIdAndUpdate(
        item.itemId,
        { $inc: { stockQty: item.quantity } }
      )
    );
    
    await Promise.all(restockPromises);
    
    // Calculate and save RTO charges
    const forwardShipping = order.shipping?.total || 0;
    const rtoCharges = forwardShipping * 2;
    
    await Order.findByIdAndUpdate(
      orderId,
      {
        rtoCharges,
        logisticsLoss: rtoCharges
      }
    );
    
    console.log(`RTO handled atomically for order ${orderId}: Items restocked, RTO charges: ₹${rtoCharges}`);
  } catch (error) {
    console.error('Atomic RTO handling error:', error);
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
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID required' });
    }
    
    const order = await Order.findById(orderId)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name weight');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Validate order state before shipment creation
    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot create shipment for unpaid order' 
      });
    }

    if (order.status !== 'confirmed') {
      return res.status(400).json({ 
        success: false, 
        message: 'Order must be confirmed before shipment creation' 
      });
    }

    if (order.deliveryProvider !== 'DELHIVERY') {
      return res.status(400).json({ 
        success: false, 
        message: 'Shipment creation only for DELHIVERY orders' 
      });
    }

    if (order.waybill) {
      return res.status(400).json({ 
        success: false, 
        message: 'Shipment already created',
        waybill: order.waybill
      });
    }

    if ((order.shipmentAttempts || 0) >= 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Maximum shipment attempts exceeded' 
      });
    }
    
    // Get delivery address
    const deliveryAddress = order.userId?.address?.find(
      addr => String(addr._id) === String(order.addressId)
    );

    if (!deliveryAddress) {
      return res.status(400).json({ 
        success: false, 
        message: 'Delivery address not found' 
      });
    }

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

    const result = await delhiveryService.createShipment(shipmentData);
    
    if (result.success) {
      // Use updateOrderSignals with WEBHOOK source for shipment creation
      const updateFields = updateOrderSignals(order, { deliveryStatus: result.status }, { source: 'WEBHOOK' });
      
      await Order.findByIdAndUpdate(
        order._id,
        {
          ...updateFields,
          waybill: result.waybill,
          shipmentCreated: true,
          shipmentAttempts: (order.shipmentAttempts || 0) + 1,
          'shipping.charged': order.shipping ? true : undefined
        },
        { new: true, runValidators: true }
      );
      
      console.log(`Shipment created for order ${order._id}: ${result.waybill}`);
    } else {
      // Increment attempt counter even on failure
      await Order.findByIdAndUpdate(
        order._id,
        { $inc: { shipmentAttempts: 1 } }
      );
    }

    res.json({
      success: result.success,
      waybill: result.waybill,
      status: result.status,
      estimatedDelivery: result.estimatedDelivery,
      error: result.error
    });
  } catch (error) {
    console.error('Shipment creation error:', error.message);
    res.status(500).json({ success: false, error: 'Shipment creation failed' });
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