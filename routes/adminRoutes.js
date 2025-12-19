const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// Admin Dashboard Route
router.get('/dashboard', verifyToken, verifyAdmin, (req, res) => {
  res.json({ 
    success: true, 
    message: 'Admin dashboard access granted',
    user: req.user 
  });
});

module.exports = router;