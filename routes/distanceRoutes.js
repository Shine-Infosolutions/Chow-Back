const express = require('express');
const { calculateDistance } = require('../controllers/distanceController');

const router = express.Router();

router.post('/calculate-distance', calculateDistance);

module.exports = router;