const Category = require('../models/Category');

// Get all categories with pagination
exports.getCategories = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const categories = await Category.find()
      .skip(skip)
      .limit(limit)
      .sort({ displayRank: 1, createdAt: -1 });
    
    const total = await Category.countDocuments();
    
    res.json({
      categories,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get category by ID
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create category
exports.createCategory = async (req, res) => {
  try {
    const { displayRank } = req.body;
    
    // Check if displayRank already exists
    if (displayRank !== undefined && displayRank > 0) {
      const existingCategory = await Category.findOne({ displayRank });
      if (existingCategory) {
        return res.status(400).json({ 
          success: false,
          message: `Rank ${displayRank} already assigned to "${existingCategory.name}"` 
        });
      }
    }
    
    const category = new Category(req.body);
    const savedCategory = await category.save();
    res.status(201).json({ success: true, category: savedCategory });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Update category
exports.updateCategory = async (req, res) => {
  try {
    const { displayRank } = req.body;
    
    // Check if displayRank already exists for another category
    if (displayRank !== undefined && displayRank > 0) {
      const existingCategory = await Category.findOne({ 
        displayRank, 
        _id: { $ne: req.params.id } 
      });
      if (existingCategory) {
        return res.status(400).json({ 
          success: false,
          message: `Rank ${displayRank} already assigned to "${existingCategory.name}"` 
        });
      }
    }
    
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
    res.json({ success: true, category });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete category
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all categories for homepage (sorted by display rank)
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find()
      .sort({ displayRank: 1, createdAt: -1 });
    
    res.json({ categories });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};