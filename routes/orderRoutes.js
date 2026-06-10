const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken, verifyAdmin } = require('../middleware');

// Get all orders
router.get('/', orderController.getAllOrders);

// Get failed orders
router.get('/failed', orderController.getFailedOrders);

// Get orders by user ID
router.get('/my/:userId', orderController.getMyOrders);

// Invoice (public HTML — shareable link, printable / downloadable)
router.get('/:id/invoice', orderController.getInvoice);

// Get order by ID
router.get('/:id', orderController.getOrderById);

// Get admin permissions for order
router.get('/:id/permissions', orderController.getOrderPermissions);

// Admin: send / resend the order-confirmation email to the customer
router.post('/:id/send-confirmation', verifyToken, verifyAdmin, orderController.sendConfirmation);



// Update payment status
router.patch('/:id/payment-status', orderController.updatePaymentStatus);

// Update delivery status (for self-delivery orders only)
router.patch('/:id/delivery-status', orderController.updateDeliveryStatus);

// Update general status (for SELF delivery orders only)
router.patch('/:id/status', orderController.updateStatus);

// Customer: update contact number(s) on their own order
router.patch('/:id/contact', verifyToken, orderController.updateOrderContact);

// Admin: set the delivery date after accepting an order
router.patch('/:id/delivery-date', verifyToken, verifyAdmin, orderController.updateDeliveryDate);

// Admin: cancel order (restock + refund state), mark delayed/reschedule, internal notes
router.patch('/:id/cancel', verifyToken, verifyAdmin, orderController.cancelOrder);
router.patch('/:id/delay', verifyToken, verifyAdmin, orderController.markDelayed);
router.patch('/:id/notes', verifyToken, verifyAdmin, orderController.updateAdminNotes);

// Bulk status update
router.patch('/bulk/status', orderController.bulkUpdateStatus);



module.exports = router;