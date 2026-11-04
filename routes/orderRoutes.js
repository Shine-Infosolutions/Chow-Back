const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken, verifyAdmin, requireOwnerOrAdmin } = require('../middleware');

const admin = [verifyToken, verifyAdmin];

// ---- Admin lists (declared before '/:id') ----
router.get('/admin', admin, orderController.getAdminOrders);
router.get('/admin/export', admin, orderController.exportAdminOrders);
router.get('/', admin, orderController.getAllOrders);          // legacy list (paid orders)
router.get('/failed', admin, orderController.getFailedOrders); // legacy list (unpaid orders)
router.patch('/bulk/status', admin, orderController.bulkUpdateStatus); // must precede '/:id/status'

// ---- Customer ----
router.get('/my/:userId', verifyToken, requireOwnerOrAdmin('userId'), orderController.getMyOrders);
router.get('/:id/invoice', orderController.getInvoice); // public, requires ?t=<invoiceToken>
router.get('/:id', verifyToken, orderController.getOrderById); // owner or admin (checked in controller)
router.patch('/:id/contact', verifyToken, orderController.updateOrderContact);

// ---- Admin actions ----
router.get('/:id/permissions', admin, orderController.getOrderPermissions);
router.post('/:id/send-confirmation', admin, orderController.sendConfirmation);
router.post('/:id/refund', admin, orderController.refundOrder);
router.patch('/:id/payment-status', admin, orderController.updatePaymentStatus);
router.patch('/:id/delivery-status', admin, orderController.updateDeliveryStatus);
router.patch('/:id/status', admin, orderController.updateStatus);
router.patch('/:id/delivery-date', admin, orderController.updateDeliveryDate);
router.patch('/:id/cancel', admin, orderController.cancelOrder);
router.patch('/:id/delay', admin, orderController.markDelayed);
router.patch('/:id/notes', admin, orderController.updateAdminNotes);

module.exports = router;
