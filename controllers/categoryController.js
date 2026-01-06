const Category = require('../models/Category');

const DEFAULT_PAGINATION = { page: 1, limit: 10 };

const getPaginationParams = (query) => {
  const page = parseInt(query.page) || DEFAULT_PAGINATION.page;
  const limit = parseInt(query.limit) || DEFAULT_PAGINATION.limit;
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const handleAsyncRoute = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkDisplayRankConflict = async (displayRank, excludeId = null) => {
  if (displayRank === undefined || displayRank <= 0) return null;
  
  const query = { displayRank };
  if (excludeId) query._id = { $ne: excludeId };
  
  const existingCategory = await Category.findOne(query);
  return existingCategory 
    ? `Rank ${displayRank} already assigned to "${existingCategory.name}"`
    : null;
};

// Get all categories with pagination
exports.getCategories = handleAsyncRoute(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req.query);

  const [categories, total] = await Promise.all([
    Category.find()
      .skip(skip)
      .limit(limit)
      .sort({ displayRank: 1, createdAt: -1 }),
    Category.countDocuments()
  ]);
  
  res.json({
    success: true,
    categories,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// Get category by ID
exports.getCategoryById = handleAsyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  res.json({ success: true, category });
});

// Create category
exports.createCategory = handleAsyncRoute(async (req, res) => {
  const conflictMessage = await checkDisplayRankConflict(req.body.displayRank);
  if (conflictMessage) {
    return res.status(400).json({ success: false, message: conflictMessage });
  }
  
  const category = await new Category(req.body).save();
  res.status(201).json({ success: true, category });
});

// Update category
exports.updateCategory = handleAsyncRoute(async (req, res) => {
  const conflictMessage = await checkDisplayRankConflict(req.body.displayRank, req.params.id);
  if (conflictMessage) {
    return res.status(400).json({ success: false, message: conflictMessage });
  }
  
  const category = await Category.findByIdAndUpdate(
    req.params.id, 
    req.body, 
    { new: true, runValidators: true }
  );
  
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  
  res.json({ success: true, category });
});

// Delete category
exports.deleteCategory = handleAsyncRoute(async (req, res) => {
  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  res.json({ success: true, message: 'Category deleted successfully' });
});

// Get all categories for homepage (sorted by display rank)
exports.getAllCategories = handleAsyncRoute(async (req, res) => {
  const categories = await Category.find()
    .sort({ displayRank: 1, createdAt: -1 });
  
  res.json({ success: true, categories });
});