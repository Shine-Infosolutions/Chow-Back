const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const User = require('../models/User');

// Admin dashboard
router.get('/', verifyToken, verifyAdmin, (req, res) => {
  res.json({ 
    message: 'Admin Dashboard',
    admin: req.user.name,
    timestamp: new Date().toISOString()
  });
});

// Get all users
router.get('/users', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Make user admin
router.put('/users/:id/role', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    await User.findByIdAndUpdate(req.params.id, { role });
    res.json({ message: 'Role updated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;