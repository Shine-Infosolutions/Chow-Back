const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// Get all orders
router.get('/', orderController.getAllOrders);

// Get orders by user ID
router.get('/my/:userId', orderController.getMyOrders);

// Get order by ID
router.get('/:id', orderController.getOrderById);

// Create new order
router.post('/', orderController.createOrder);

// Update order status
router.patch('/:id/status', orderController.updateOrderStatus);

// Update payment status
router.patch('/:id/payment-status', orderController.updatePaymentStatus);

module.exports = router;