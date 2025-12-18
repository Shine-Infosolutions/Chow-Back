const User = require('../models/User');

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
    
    console.log('Returning addresses:', addressesWithId);
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
    console.log('New address ID:', newAddress._id);
    
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