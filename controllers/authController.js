const User = require('../models/User');
const jwt = require('jsonwebtoken');

const generateToken = (id, role) => 
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });

const sanitizeUser = (user) => {
  const { password, ...userData } = user.toObject();
  return userData;
};

const validateRequiredFields = (fields, data) => {
  const missing = fields.filter(field => !data[field]);
  return missing.length ? `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required` : null;
};

// User Registration
exports.userRegister = async (req, res) => {
  try {
    const { name, email, password, phone, address } = req.body;
    
    const validationError = validateRequiredFields(['name', 'email', 'password', 'phone'], req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const user = await new User({ name, email, password, phone, address }).save();
    const token = generateToken(user._id, user.role);
    
    res.status(201).json({ 
      success: true, 
      user: sanitizeUser(user), 
      token 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// User Login
exports.userLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const validationError = validateRequiredFields(['email', 'password'], req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const user = await User.findOne({ email, status: 'active' });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(user._id, user.role);
    res.json({ success: true, user: sanitizeUser(user), token });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin Login
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const validationError = validateRequiredFields(['email', 'password'], req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const user = await User.findOne({ email, role: 'admin', status: 'active' });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const token = generateToken(user._id, user.role);
    res.json({ success: true, user: sanitizeUser(user), token });
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

// Address Management
const findUserById = async (id) => {
  const user = await User.findById(id);
  if (!user) throw new Error('User not found');
  return user;
};

const setDefaultAddress = (addresses, isDefault) => {
  if (isDefault) {
    addresses.forEach(addr => addr.isDefault = false);
  }
};

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

exports.addAddress = async (req, res) => {
  try {
    const requiredFields = ['addressType', 'firstName', 'lastName', 'street', 'city', 'state', 'postcode', 'email', 'phone'];
    const validationError = validateRequiredFields(requiredFields, req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const user = await findUserById(req.params.id);
    setDefaultAddress(user.address, req.body.isDefault);
    
    user.address.push(req.body);
    const savedUser = await user.save();
    
    res.status(201).json({ 
      success: true, 
      message: 'Address added successfully', 
      address: savedUser.address 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateAddress = async (req, res) => {
  try {
    const user = await findUserById(req.params.id);
    const address = user.address.id(req.params.addressId);
    
    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    setDefaultAddress(user.address, req.body.isDefault);
    Object.assign(address, req.body);
    await user.save();
    
    res.json({ success: true, address: user.address });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteAddress = async (req, res) => {
  try {
    const user = await findUserById(req.params.id);
    const address = user.address.id(req.params.addressId);
    
    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    address.deleteOne();
    await user.save();
    
    res.json({ success: true, address: user.address });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
