const express = require('express');
const router = express.Router();
const deliveryController = require('../controllers/deliveryController');

// Check delivery options for a pincode
router.get('/check/:pincode', deliveryController.checkDeliveryOptions);

module.exports = router;