const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// Get all orders
router.get('/', orderController.getAllOrders);

// Get failed orders
router.get('/failed', orderController.getFailedOrders);

// Get orders by user ID
router.get('/my/:userId', orderController.getMyOrders);

// Get order by ID
router.get('/:id', orderController.getOrderById);

// Get admin permissions for order
router.get('/:id/permissions', orderController.getOrderPermissions);



// Update payment status
router.patch('/:id/payment-status', orderController.updatePaymentStatus);

// Update delivery status (for self-delivery orders only)
router.patch('/:id/delivery-status', orderController.updateDeliveryStatus);

// Update general status (for SELF delivery orders only)
router.patch('/:id/status', orderController.updateStatus);

// Bulk status update
router.patch('/bulk/status', orderController.bulkUpdateStatus);



module.exports = router;