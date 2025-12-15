const Item = require('../models/Item');
const { uploadToCloudinary } = require('../middleware/upload');

// Get all items
exports.getItems = async (req, res) => {
  try {
    const items = await Item.find().populate('category subcategory');
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get item by ID
exports.getItemById = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id).populate('category subcategory');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get items by category
exports.getItemsByCategory = async (req, res) => {
  try {
    const items = await Item.find({ category: req.params.categoryId }).populate('category subcategory');
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get items by subcategory
exports.getItemsBySubcategory = async (req, res) => {
  try {
    const items = await Item.find({ subcategory: req.params.subcategoryId }).populate('category subcategory');
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get featured items
exports.getFeaturedItems = async (req, res) => {
  try {
    const { type } = req.params;
    let query = {};
    
    switch(type) {
      case 'bestseller': query.isBestSeller = true; break;
      case 'bestrated': query.isBestRated = true; break;
      case 'onsale': query.isOnSale = true; break;
      case 'popular': query.isPopular = true; break;
      default: return res.status(400).json({ message: 'Invalid type' });
    }
    
    const items = await Item.find(query).populate('category subcategory');
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create item
exports.createItem = async (req, res) => {
  try {
    const itemData = { ...req.body };
    
    // Upload images to Cloudinary
    if (req.files && req.files.images) {
      const imageUrls = [];
      for (const file of req.files.images) {
        const url = await uploadToCloudinary(file.buffer, 'image');
        imageUrls.push(url);
      }
      itemData.images = imageUrls;
    }
    
    // Upload video to Cloudinary
    if (req.files && req.files.video && req.files.video[0]) {
      const videoUrl = await uploadToCloudinary(req.files.video[0].buffer, 'video');
      itemData.video = videoUrl;
    }
    
    const item = new Item(itemData);
    const savedItem = await item.save();
    res.status(201).json(savedItem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update item
exports.updateItem = async (req, res) => {
  try {
    const itemData = { ...req.body };
    
    // Upload new images to Cloudinary if provided
    if (req.files && req.files.images) {
      const imageUrls = [];
      for (const file of req.files.images) {
        const url = await uploadToCloudinary(file.buffer, 'image');
        imageUrls.push(url);
      }
      itemData.images = imageUrls;
    }
    
    // Upload new video to Cloudinary if provided
    if (req.files && req.files.video && req.files.video[0]) {
      const videoUrl = await uploadToCloudinary(req.files.video[0].buffer, 'video');
      itemData.video = videoUrl;
    }
    
    const item = await Item.findByIdAndUpdate(req.params.id, itemData, { new: true });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete item
exports.deleteItem = async (req, res) => {
  try {
    const item = await Item.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};