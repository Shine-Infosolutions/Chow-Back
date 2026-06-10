const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, verifyAdmin } = require('../middleware');

// Admin: list / search customers
router.get('/', verifyToken, verifyAdmin, userController.getUsers);

// Get user addresses
router.get('/:userId/addresses', userController.getUserAddresses);

// Add new address
router.post('/:userId/addresses', userController.addAddress);

// Update address
router.put('/:userId/addresses/:addressId', userController.updateAddress);

// Delete address
router.delete('/:userId/addresses/:addressId', userController.deleteAddress);

module.exports = router;