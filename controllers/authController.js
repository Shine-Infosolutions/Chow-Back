const User = require('../models/User');
const jwt = require('jsonwebtoken');

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// User Registration
exports.userRegister = async (req, res) => {
  try {
    const { name, email, password, phone, address } = req.body;
    
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ success: false, message: 'Name, email, password, and phone are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const user = new User({ name, email, password, phone, address });
    await user.save();

    const token = generateToken(user._id, user.role);
    const { password: _, ...userData } = user.toObject();
    res.status(201).json({ success: true, user: userData, token });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// User Login
exports.userLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email, status: 'active' });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(user._id, user.role);
    const { password: _, ...userData } = user.toObject();
    res.json({ success: true, user: userData, token });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// User Profile
exports.userProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update User Profile
exports.updateUserProfile = async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, phone, address },
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Add Address
exports.addAddress = async (req, res) => {
  try {
    const { addressType, firstName, lastName, street, city, state, postcode, email, phone } = req.body;
    
    if (!addressType || !firstName || !lastName || !street || !city || !state || !postcode || !email || !phone) {
      return res.status(400).json({ success: false, message: 'All required fields must be provided' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (req.body.isDefault) {
      user.address.forEach(addr => addr.isDefault = false);
    }

    user.address.push(req.body);
    const savedUser = await user.save();
    
    res.status(201).json({ success: true, message: 'Address added successfully', address: savedUser.address });
  } catch (error) {
    console.error('Add address error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update Address
exports.updateAddress = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const address = user.address.id(req.params.addressId);
    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    if (req.body.isDefault) {
      user.address.forEach(addr => addr.isDefault = false);
    }

    Object.assign(address, req.body);
    await user.save();
    
    res.json({ success: true, address: user.address });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete Address
exports.deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.address.id(req.params.addressId).remove();
    await user.save();
    
    res.json({ success: true, address: user.address });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get All Addresses
exports.getAddresses = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('address');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({ success: true, address: user.address });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin Login
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email, role: 'admin', status: 'active' });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const token = generateToken(user._id, user.role);
    const { password: _, ...userData } = user.toObject();
    res.json({ success: true, user: userData, token });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};



