const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');

// Global search
router.get('/', searchController.globalSearch);

// Search items with filters
router.get('/items', searchController.searchItems);

// Search customers
router.get('/customers', searchController.searchCustomers);

// Search orders
router.get('/orders', searchController.searchOrders);

module.exports = router;