const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, verifyUser, verifyAdmin } = require('../middleware/auth');

// Public Routes
router.post('/register', authController.userRegister);
router.post('/login', authController.userLogin);
router.post('/admin/login', authController.adminLogin);

// Protected User Routes
router.get('/profile/:id', verifyToken, authController.userProfile);
router.put('/profile/:id', verifyToken, authController.updateUserProfile);

// Address Routes
router.get('/address/:id', verifyToken, authController.getAddresses);
router.post('/address/:id', verifyToken, authController.addAddress);
router.put('/address/:id/:addressId', verifyToken, authController.updateAddress);
router.delete('/address/:id/:addressId', verifyToken, authController.deleteAddress);

module.exports = router;