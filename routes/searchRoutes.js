const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { verifyToken, verifyAdmin } = require('../middleware');

const admin = [verifyToken, verifyAdmin];

router.get('/items', searchController.searchItems); // public storefront search
router.get('/', admin, searchController.globalSearch);
router.get('/customers', admin, searchController.searchCustomers);
router.get('/orders', admin, searchController.searchOrders);

module.exports = router;
