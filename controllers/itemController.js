const Item = require('../models/Item');
const { uploadToCloudinary } = require('../middleware');

const POPULATE_OPTIONS = 'categories subcategories';
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

const uploadFiles = async (files) => {
  const result = {};
  
  if (files?.images) {
    result.images = await Promise.all(
      files.images.map(file => uploadToCloudinary(file.buffer, 'image'))
    );
  }
  
  if (files?.video?.[0]) {
    result.video = await uploadToCloudinary(files.video[0].buffer, 'video');
  }
  
  return result;
};

// Get all items
exports.getItems = handleAsyncRoute(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req.query);

  const [items, total] = await Promise.all([
    Item.find()
      .populate(POPULATE_OPTIONS)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    Item.countDocuments()
  ]);
  
  res.json({
    success: true,
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// Get item by ID
exports.getItemById = handleAsyncRoute(async (req, res) => {
  const item = await Item.findById(req.params.id).populate(POPULATE_OPTIONS);
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  res.json({ success: true, item });
});

// Get items by category
exports.getItemsByCategory = handleAsyncRoute(async (req, res) => {
  const items = await Item.find({ 
    categories: req.params.categoryId, 
    stockQty: { $gt: 0 } 
  }).populate(POPULATE_OPTIONS);
  
  res.json({ success: true, items });
});

// Get items by subcategory
exports.getItemsBySubcategory = handleAsyncRoute(async (req, res) => {
  const items = await Item.find({ 
    subcategories: req.params.subcategoryId, 
    stockQty: { $gt: 0 } 
  }).populate(POPULATE_OPTIONS);
  
  res.json({ success: true, items });
});

// Get featured items
exports.getFeaturedItems = handleAsyncRoute(async (req, res) => {
  const { type } = req.params;
  const query = { stockQty: { $gt: 0 } };
  
  const typeMap = {
    bestseller: 'isBestSeller',
    bestrated: 'isBestRated',
    onsale: 'isOnSale',
    popular: 'isPopular'
  };
  
  const field = typeMap[type];
  if (!field) {
    return res.status(400).json({ success: false, message: 'Invalid type' });
  }
  
  query[field] = true;
  const items = await Item.find(query).populate(POPULATE_OPTIONS);
  res.json({ success: true, items });
});

// Create item
exports.createItem = handleAsyncRoute(async (req, res) => {
  const itemData = { ...req.body };
  const uploadedFiles = await uploadFiles(req.files);
  
  Object.assign(itemData, uploadedFiles);
  
  const item = await new Item(itemData).save();
  res.status(201).json({ success: true, item });
});

// Update item
exports.updateItem = handleAsyncRoute(async (req, res) => {
  const itemData = { ...req.body };
  const uploadedFiles = await uploadFiles(req.files);
  
  Object.assign(itemData, uploadedFiles);
  
  const item = await Item.findByIdAndUpdate(
    req.params.id, 
    itemData, 
    { new: true, runValidators: true }
  );
  
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  
  res.json({ success: true, item });
});

// Delete item
exports.deleteItem = handleAsyncRoute(async (req, res) => {
  const item = await Item.findByIdAndDelete(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  res.json({ success: true, message: 'Item deleted successfully' });
});