const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken, verifyAdmin } = require('../middleware');

router.get('/summary', verifyToken, verifyAdmin, reportController.getSummary);
router.get('/export', verifyToken, verifyAdmin, reportController.exportReport);

module.exports = router;
