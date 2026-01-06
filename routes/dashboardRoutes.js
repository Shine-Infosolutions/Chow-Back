const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const orderController = require('../controllers/orderController');
const { verifyToken, verifyAdmin } = require('../middleware');

router.get('/stats', verifyToken, verifyAdmin, dashboardController.getDashboardStats);
router.get('/failed-orders', verifyToken, verifyAdmin, orderController.getFailedOrders);

module.exports = router;