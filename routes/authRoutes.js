const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, requireOwnerOrAdmin, authLimiter, registerLimiter, guestLimiter } = require('../middleware');

// Public (rate limited). POST /admin/register was removed: admins are created by seed.js only.
router.post('/register', registerLimiter, authController.userRegister);
router.post('/guest', guestLimiter, authController.guestLogin); // mobile-only guest checkout
router.post('/login', authLimiter, authController.userLogin);
router.post('/admin/login', authLimiter, authController.adminLogin);

// Authenticated
router.get('/me', verifyToken, authController.me);
router.post('/claim', verifyToken, authController.claimAccount);
router.delete('/account', verifyToken, authController.deleteAccount);
router.get('/profile/:id', verifyToken, requireOwnerOrAdmin('id'), authController.userProfile);
router.put('/profile/:id', verifyToken, requireOwnerOrAdmin('id'), authController.updateUserProfile);

// The duplicate /auth/address/* API was removed (storefront uses /users/:userId/addresses).

module.exports = router;
