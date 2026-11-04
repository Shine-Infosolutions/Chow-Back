const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Public: pincode -> city/district/state + whether we deliver there.
router.get('/pincode/:pincode', userController.lookupPincode);

module.exports = router;
