const Subcategory = require('../models/Subcategory');
const { asyncHandler, httpError, toStr, parsePagination, isValidId } = require('../utils/http');

// Response shapes (raw docs / arrays) are kept as-is because the storefront reads them that way.

const pickSubcategory = (body = {}) => {
  const out = {};
  if (body.name !== undefined) out.name = toStr(body.name).slice(0, 100);
  if (body.description !== undefined) out.description = toStr(body.description).slice(0, 1000);
  if (body.status !== undefined) {
    const s = toStr(body.status);
    if (!['active', 'inactive'].includes(s)) throw httpError(400, 'Invalid status');
    out.status = s;
  }
  const cats = body.categories !== undefined ? body.categories : body.category;
  if (cats !== undefined) {
    const list = (Array.isArray(cats) ? cats : toStr(cats).split(',')).map((c) => toStr(c?._id || c)).filter(Boolean);
    if (list.some((c) => !isValidId(c))) throw httpError(400, 'Invalid categories');
    out.categories = [...new Set(list)];
  }
  return out;
};

exports.getSubcategories = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 1000 });
  const [subcategories, total] = await Promise.all([
    Subcategory.find().populate('categories').skip(skip).limit(limit).sort({ createdAt: -1 }),
    Subcategory.countDocuments(),
  ]);
  res.json({ success: true, subcategories, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

exports.getSubcategoryById = asyncHandler(async (req, res) => {
  const subcategory = await Subcategory.findById(toStr(req.params.id)).populate('categories');
  if (!subcategory) throw httpError(404, 'Subcategory not found');
  res.json(subcategory);
});

exports.getSubcategoriesByCategory = asyncHandler(async (req, res) => {
  const id = toStr(req.params.categoryId);
  if (!isValidId(id)) throw httpError(400, 'Invalid category id');
  const subcategories = await Subcategory.find({ categories: id }).populate('categories').limit(1000);
  res.json(subcategories);
});

exports.createSubcategory = asyncHandler(async (req, res) => {
  const data = pickSubcategory(req.body);
  if (!data.name) throw httpError(400, 'name is required');
  if (!data.categories?.length) throw httpError(400, 'At least one category is required');
  const saved = await new Subcategory(data).save();
  res.status(201).json(saved);
});

exports.updateSubcategory = asyncHandler(async (req, res) => {
  const data = pickSubcategory(req.body);
  const subcategory = await Subcategory.findByIdAndUpdate(toStr(req.params.id), { $set: data }, { new: true, runValidators: true });
  if (!subcategory) throw httpError(404, 'Subcategory not found');
  res.json(subcategory);
});

exports.deleteSubcategory = asyncHandler(async (req, res) => {
  const subcategory = await Subcategory.findByIdAndDelete(toStr(req.params.id));
  if (!subcategory) throw httpError(404, 'Subcategory not found');
  res.json({ success: true, message: 'Subcategory deleted successfully' });
});
