const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken, verifyAdmin } = require('../middleware');

router.get('/config', paymentController.getConfig);
router.post('/create-order', verifyToken, paymentController.createOrder);
router.post('/verify', verifyToken, paymentController.verifyPayment);
router.post('/failure', verifyToken, paymentController.handlePaymentFailure);
// HMAC is verified over req.rawBody (captured by the express.json verify hook in server.js).
router.post('/webhook', paymentController.razorpayWebhook);
router.post('/clean-failed', verifyToken, verifyAdmin, paymentController.cleanFailedOrders);
// /confirm and /fix-inconsistent were removed.

module.exports = router;
