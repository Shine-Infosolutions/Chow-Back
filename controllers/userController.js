const User = require('../models/User');

// Admin: list / search customers (paginated)
exports.getUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 12);
    const search = (req.query.search || '').trim();

    const query = {};
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      users,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get user addresses
exports.getUserAddresses = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('address');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const addressesWithId = user.address.map(addr => ({
      ...addr.toObject(),
      _id: addr._id
    }));
    

    res.json({ success: true, addresses: addressesWithId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Add new address
exports.addAddress = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.address.push(req.body);
    await user.save();
    
    const newAddress = user.address[user.address.length - 1];

    
    res.status(201).json({ 
      success: true, 
      address: newAddress,
      addressId: newAddress._id.toString(),
      addresses: user.address 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update address
exports.updateAddress = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const address = user.address.id(req.params.addressId);
    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    
    Object.assign(address, req.body);
    await user.save();
    
    res.json({ success: true, addresses: user.address });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete address
exports.deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.address.id(req.params.addressId).remove();
    await user.save();
    
    res.json({ success: true, addresses: user.address });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};