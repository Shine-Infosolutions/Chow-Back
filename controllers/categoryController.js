const Category = require('../models/Category');
const { asyncHandler, httpError, toStr, parsePagination } = require('../utils/http');

// Only these fields may be written by the admin.
const pickCategory = (body = {}) => {
  const out = {};
  if (body.name !== undefined) out.name = toStr(body.name).slice(0, 100);
  if (body.description !== undefined) out.description = toStr(body.description).slice(0, 1000);
  if (body.displayRank !== undefined) {
    const n = Number(toStr(body.displayRank) || 0);
    if (!Number.isInteger(n) || n < 0) throw httpError(400, 'displayRank must be a non-negative integer');
    out.displayRank = n;
  }
  if (body.status !== undefined) {
    const s = toStr(body.status);
    if (!['active', 'inactive'].includes(s)) throw httpError(400, 'Invalid status');
    out.status = s;
  }
  return out;
};

const checkDisplayRankConflict = async (displayRank, excludeId = null) => {
  if (displayRank === undefined || displayRank <= 0) return;
  const query = { displayRank };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await Category.findOne(query);
  if (existing) throw httpError(409, `Rank ${displayRank} already assigned to "${existing.name}"`);
};

exports.getCategories = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 1000 });
  const [categories, total] = await Promise.all([
    Category.find().skip(skip).limit(limit).sort({ displayRank: 1, createdAt: -1 }),
    Category.countDocuments(),
  ]);
  res.json({ success: true, categories, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

exports.getCategoryById = asyncHandler(async (req, res) => {
  const category = await Category.findById(toStr(req.params.id));
  if (!category) throw httpError(404, 'Category not found');
  res.json({ success: true, category });
});

exports.createCategory = asyncHandler(async (req, res) => {
  const data = pickCategory(req.body);
  if (!data.name) throw httpError(400, 'name is required');
  await checkDisplayRankConflict(data.displayRank);
  const category = await new Category(data).save();
  res.status(201).json({ success: true, category });
});

exports.updateCategory = asyncHandler(async (req, res) => {
  const data = pickCategory(req.body);
  await checkDisplayRankConflict(data.displayRank, toStr(req.params.id));
  const category = await Category.findByIdAndUpdate(toStr(req.params.id), { $set: data }, { new: true, runValidators: true });
  if (!category) throw httpError(404, 'Category not found');
  res.json({ success: true, category });
});

exports.deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndDelete(toStr(req.params.id));
  if (!category) throw httpError(404, 'Category not found');
  res.json({ success: true, message: 'Category deleted successfully' });
});

// Homepage (sorted by display rank)
exports.getAllCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ displayRank: 1, createdAt: -1 }).limit(1000);
  res.json({ success: true, categories });
});
