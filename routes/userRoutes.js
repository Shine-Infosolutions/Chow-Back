const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, verifyAdmin, requireOwnerOrAdmin } = require('../middleware');

const owner = [verifyToken, requireOwnerOrAdmin('userId')];

// Admin: list / search customers
router.get('/', verifyToken, verifyAdmin, userController.getUsers);

// Address book (owner or admin)
router.get('/:userId/addresses', owner, userController.getUserAddresses);
router.post('/:userId/addresses', owner, userController.addAddress);
router.put('/:userId/addresses/:addressId', owner, userController.updateAddress);
router.delete('/:userId/addresses/:addressId', owner, userController.deleteAddress);

module.exports = router;
