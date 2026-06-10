const express = require('express');
const router = express.Router();
const pushController = require('../controllers/pushController');
const { verifyToken } = require('../middleware');

// Public — used by the browser to build a subscription
router.get('/vapid-public-key', pushController.getPublicKey);

// Authenticated — tie a device subscription to the logged-in user
router.post('/subscribe', verifyToken, pushController.subscribe);
router.post('/unsubscribe', verifyToken, pushController.unsubscribe);
router.post('/test', verifyToken, pushController.sendTest);

module.exports = router;
