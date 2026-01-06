const SweetDeal = require('../models/SweetDeal');
const { uploadToCloudinary } = require('../middleware');

// Get active sweet deal
const getActiveDeal = async (req, res) => {
  try {
    const deal = await SweetDeal.findOne({ isActive: true }).sort({ createdAt: -1 });
    
    if (!deal) {
      return res.status(404).json({ message: 'No active deal found' });
    }
    
    res.json(deal);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create new sweet deal
const createDeal = async (req, res) => {
  try {
    const dealData = { ...req.body };
    
    // If this deal is being set as active, deactivate all other deals
    if (dealData.isActive === 'true' || dealData.isActive === true) {
      await SweetDeal.updateMany({}, { isActive: false });
      dealData.isActive = true;
    }
    
    // Create deal first without video
    const deal = new SweetDeal(dealData);
    const savedDeal = await deal.save();
    
    // Upload video asynchronously if provided
    if (req.files && req.files.video && req.files.video[0]) {
      uploadToCloudinary(req.files.video[0].buffer, 'video')
        .then(videoUrl => {
          SweetDeal.findByIdAndUpdate(savedDeal._id, { videoUrl }).exec();
        })
        .catch(err => {});
    }
    
    res.status(201).json(savedDeal);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update sweet deal
const updateDeal = async (req, res) => {
  try {
    const dealData = { ...req.body };
    
    // If this deal is being set as active, deactivate all other deals
    if (dealData.isActive === 'true' || dealData.isActive === true) {
      await SweetDeal.updateMany({ _id: { $ne: req.params.id } }, { isActive: false });
      dealData.isActive = true;
    }
    
    // Update deal first without video
    const deal = await SweetDeal.findByIdAndUpdate(
      req.params.id,
      dealData,
      { new: true, runValidators: true }
    );
    
    if (!deal) {
      return res.status(404).json({ message: 'Deal not found' });
    }
    
    // Upload video asynchronously if provided
    if (req.files && req.files.video && req.files.video[0]) {
      uploadToCloudinary(req.files.video[0].buffer, 'video')
        .then(videoUrl => {
          SweetDeal.findByIdAndUpdate(req.params.id, { videoUrl }).exec();
        })
        .catch(err => {});
    }
    
    res.json(deal);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete sweet deal
const deleteDeal = async (req, res) => {
  try {
    const deal = await SweetDeal.findByIdAndDelete(req.params.id);
    
    if (!deal) {
      return res.status(404).json({ message: 'Deal not found' });
    }
    
    res.json({ message: 'Deal deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all deals
const getAllDeals = async (req, res) => {
  try {
    const deals = await SweetDeal.find().sort({ createdAt: -1 });
    res.json(deals);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getActiveDeal,
  createDeal,
  updateDeal,
  deleteDeal,
  getAllDeals
};