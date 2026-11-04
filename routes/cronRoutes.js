const express = require('express');
const router = express.Router();
const cronController = require('../controllers/cronController');

// Auth: `Authorization: Bearer ${CRON_SECRET}` (checked in the controller).
router.get('/reconcile', cronController.reconcilePayments);

module.exports = router;
