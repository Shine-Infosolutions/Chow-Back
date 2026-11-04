const express = require('express');
const router = express.Router();
const delhiveryController = require('../controllers/delhiveryController');
const { verifyToken, verifyAdmin } = require('../middleware');

// Webhook: shared-secret authenticated (DELHIVERY_WEBHOOK_SECRET required)
router.post('/webhook', delhiveryController.delhiveryWebhook);
// Public quotes
router.get('/pincode/:pincode', delhiveryController.checkPincode);
router.post('/calculate-rate', delhiveryController.calculateRate);

router.post('/create-shipment', verifyToken, verifyAdmin, delhiveryController.createShipment);
router.get('/track/:waybill', verifyToken, delhiveryController.trackShipment);     // owner or admin
router.get('/track-order/:orderId', verifyToken, delhiveryController.trackOrder);  // owner or admin

module.exports = router;
