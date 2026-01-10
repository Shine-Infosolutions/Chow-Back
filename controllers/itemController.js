const Item = require('../models/Item');
const { uploadToCloudinary } = require('../middleware');

const POPULATE_OPTIONS = 'categories subcategories';
const STOCK_FILTER = { stockQty: { $gt: 0 } };

const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
  return { page, limit, skip: (page - 1) * limit };
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const uploadFiles = async (files) => {
  const uploads = {};
  if (files?.images) {
    uploads.images = await Promise.all(
      files.images.map(file => uploadToCloudinary(file.buffer, 'image'))
    );
  }
  if (files?.video?.[0]) {
    uploads.video = await uploadToCloudinary(files.video[0].buffer, 'video');
  }
  return uploads;
};

const getItemsWithQuery = async (query, pagination) => {
  const { page, limit, skip } = pagination;
  const [items, total] = await Promise.all([
    Item.find(query).populate(POPULATE_OPTIONS).skip(skip).limit(limit).sort({ createdAt: -1 }),
    Item.countDocuments(query)
  ]);
  return {
    success: true,
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  };
};

exports.getItems = asyncHandler(async (req, res) => {
  const result = await getItemsWithQuery(STOCK_FILTER, getPagination(req.query));
  res.json(result);
});

exports.getAdminItems = asyncHandler(async (req, res) => {
  const result = await getItemsWithQuery({}, getPagination(req.query));
  res.json(result);
});

exports.getItemById = asyncHandler(async (req, res) => {
  const item = await Item.findById(req.params.id).populate(POPULATE_OPTIONS);
  if (!item || item.stockQty <= 0) {
    return res.status(404).json({ success: false, message: 'Item not found or out of stock' });
  }
  res.json({ success: true, item });
});

exports.getAdminItemById = asyncHandler(async (req, res) => {
  const item = await Item.findById(req.params.id).populate(POPULATE_OPTIONS);
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  res.json({ success: true, item });
});

exports.getItemsByCategory = asyncHandler(async (req, res) => {
  const items = await Item.find({ categories: req.params.categoryId, ...STOCK_FILTER }).populate(POPULATE_OPTIONS);
  res.json({ success: true, items });
});

exports.getItemsBySubcategory = asyncHandler(async (req, res) => {
  const items = await Item.find({ subcategories: req.params.subcategoryId, ...STOCK_FILTER }).populate(POPULATE_OPTIONS);
  res.json({ success: true, items });
});

exports.getFeaturedItems = asyncHandler(async (req, res) => {
  const typeMap = {
    bestseller: 'isBestSeller',
    bestrated: 'isBestRated', 
    onsale: 'isOnSale',
    popular: 'isPopular'
  };
  
  const field = typeMap[req.params.type];
  if (!field) {
    return res.status(400).json({ success: false, message: 'Invalid type' });
  }
  
  const items = await Item.find({ [field]: true, ...STOCK_FILTER }).populate(POPULATE_OPTIONS);
  res.json({ success: true, items });
});

exports.createItem = asyncHandler(async (req, res) => {
  const uploads = await uploadFiles(req.files);
  const item = await new Item({ ...req.body, ...uploads }).save();
  res.status(201).json({ success: true, item });
});

exports.updateItem = asyncHandler(async (req, res) => {
  const uploads = await uploadFiles(req.files);
  const item = await Item.findByIdAndUpdate(
    req.params.id,
    { ...req.body, ...uploads },
    { new: true, runValidators: true }
  );
  
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  
  res.json({ success: true, item });
});

exports.deleteItem = asyncHandler(async (req, res) => {
  const item = await Item.findByIdAndDelete(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  res.json({ success: true, message: 'Item deleted successfully' });
});