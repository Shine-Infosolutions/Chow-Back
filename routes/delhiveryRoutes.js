const express = require('express');
const router = express.Router();
const delhiveryController = require('../controllers/delhiveryController');
const { verifyToken } = require('../middleware');

// Public routes
router.post('/webhook', delhiveryController.delhiveryWebhook);
router.get('/pincode/:pincode', delhiveryController.checkPincode);
router.post('/calculate-rate', delhiveryController.calculateRate);

// Protected routes (require authentication)
router.post('/create-shipment', verifyToken, delhiveryController.createShipment);
router.get('/track/:waybill', verifyToken, delhiveryController.trackShipment);
router.get('/track-order/:orderId', verifyToken, delhiveryController.trackOrder);

module.exports = router;