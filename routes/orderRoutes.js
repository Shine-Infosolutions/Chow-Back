const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

router.get('/all', orderController.getAllOrders);
router.get('/my/:customerId', orderController.getMyOrders);
router.post('/add', orderController.createOrder);

module.exports = router;