const Item = require('../models/Item');
const { uploadToCloudinary } = require('../middleware');
const { asyncHandler, httpError, toStr, isValidId, parsePagination } = require('../utils/http');

const POPULATE_OPTIONS = 'categories subcategories';
// Public catalog: in stock and not deactivated.
const PUBLIC_FILTER = { stockQty: { $gt: 0 }, status: { $ne: 'inactive' } };
const CATALOG_PAGINATION = { defaultLimit: 10, maxLimit: 1000 };

const UOMS = ['kg', 'gm', 'ltr', 'ml', 'pcs', 'box', 'pack'];
const FOOD_TYPES = ['veg', 'egg', 'nonveg'];
const ALLERGENS = ['milk', 'nuts', 'gluten', 'soy', 'sesame', 'egg'];
const GST_RATES = [0, 5, 12, 18, 28];
const FLAGS = ['isBestRated', 'isBestSeller', 'isOnSale', 'isPopular'];

// Upload files; any failure aborts the request with 502 (never silently save without media).
const uploadFiles = async (files) => {
  const uploads = {};
  if (files?.images?.length) {
    uploads.images = await Promise.all(files.images.map((file) => uploadToCloudinary(file.buffer, 'image')));
  }
  if (files?.video?.[0]) {
    uploads.video = await uploadToCloudinary(files.video[0].buffer, 'video');
  }
  return uploads;
};

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

const parseBool = (v) => {
  const s = toStr(v).toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(s)) return true;
  if (['false', '0', 'off', 'no', ''].includes(s)) return false;
  throw httpError(400, 'Invalid boolean value');
};

const parseNumber = (key, v, { min = 0, allowEmpty = false, integer = false } = {}) => {
  const s = toStr(v);
  if (s === '') {
    if (allowEmpty) return 0;
    throw httpError(400, `${key} is required`);
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) throw httpError(400, `Invalid ${key}`);
  return n;
};

// Accepts repeated fields, a JSON array string, or a comma list.
const parseIdList = (key, v) => {
  let arr;
  if (Array.isArray(v)) arr = v;
  else {
    const s = toStr(v);
    if (!s) arr = [];
    else if (s.startsWith('[')) {
      try { arr = JSON.parse(s); } catch { throw httpError(400, `Invalid ${key}`); }
    } else arr = s.split(',');
  }
  const ids = arr.map((x) => toStr(x?._id || x)).filter(Boolean);
  if (ids.some((id) => !isValidId(id))) throw httpError(400, `Invalid ${key}`);
  return [...new Set(ids)];
};

// Build an update from ONLY the fields present in the body (explicit falsy values honoured).
const buildItemFields = (body = {}) => {
  const f = {};
  for (const key of ['name', 'shortDesc', 'longDesc']) {
    if (has(body, key)) f[key] = toStr(body[key]).slice(0, key === 'longDesc' ? 5000 : 500);
  }
  if (has(body, 'price')) f.price = parseNumber('price', body.price);
  if (has(body, 'discountPrice')) f.discountPrice = parseNumber('discountPrice', body.discountPrice, { allowEmpty: true });
  if (has(body, 'stockQty')) f.stockQty = parseNumber('stockQty', body.stockQty, { integer: true });
  if (has(body, 'weight')) f.weight = parseNumber('weight', body.weight, { min: 1 });
  if (has(body, 'piecesPerUnit')) f.piecesPerUnit = parseNumber('piecesPerUnit', body.piecesPerUnit, { min: 1, integer: true });
  if (has(body, 'uom')) {
    const uom = toStr(body.uom);
    if (!UOMS.includes(uom)) throw httpError(400, 'Invalid uom');
    f.uom = uom;
  }
  if (has(body, 'status')) {
    const status = toStr(body.status);
    if (!['active', 'inactive'].includes(status)) throw httpError(400, 'Invalid status');
    f.status = status;
  }
  for (const flag of [...FLAGS, 'shippable']) if (has(body, flag)) f[flag] = parseBool(body[flag]);
  // ---- Food information ----
  if (has(body, 'foodType')) {
    const ft = toStr(body.foodType);
    if (!FOOD_TYPES.includes(ft)) throw httpError(400, 'foodType must be veg, egg or nonveg');
    f.foodType = ft;
  }
  for (const [key, max] of [['ingredients', 2000], ['storageInstructions', 500], ['bestBeforeNote', 300], ['netWeight', 50], ['countryOfOrigin', 60]]) {
    if (has(body, key)) f[key] = toStr(body[key]).slice(0, max);
  }
  if (has(body, 'allergens') || has(body, 'allergensJson')) {
    let list = has(body, 'allergensJson') ? (() => { try { return JSON.parse(toStr(body.allergensJson) || '[]'); } catch { throw httpError(400, 'Invalid allergensJson'); } })() : body.allergens;
    list = (Array.isArray(list) ? list : toStr(list).split(',')).map((a) => toStr(a).toLowerCase()).filter(Boolean);
    if (list.some((a) => !ALLERGENS.includes(a))) throw httpError(400, `allergens must be from: ${ALLERGENS.join(', ')}`);
    f.allergens = [...new Set(list)];
  }
  // Empty string → unset (store default applies).
  if (has(body, 'shelfLifeDays')) f.shelfLifeDays = toStr(body.shelfLifeDays) === '' ? undefined : parseNumber('shelfLifeDays', body.shelfLifeDays, { integer: true });
  if (has(body, 'hsnCode')) {
    const h = toStr(body.hsnCode);
    if (h && !/^\d{4,8}$/.test(h)) throw httpError(400, 'HSN must be 4–8 digits');
    f.hsnCode = h;
  }
  if (has(body, 'gstRate')) {
    const g = toStr(body.gstRate);
    if (g === '') f.gstRate = undefined; // unset → settings.checkout.defaultGstRate
    else if (!GST_RATES.includes(Number(g))) throw httpError(400, 'gstRate must be 0, 5, 12, 18 or 28');
    else f.gstRate = Number(g);
  }
  // `categoriesJson` / `subcategoriesJson` (JSON string array, may be "[]") take precedence so the
  // admin can clear a list — multipart can't express an empty repeated field.
  for (const key of ['categories', 'subcategories']) {
    if (has(body, `${key}Json`)) {
      let parsed;
      try { parsed = JSON.parse(toStr(body[`${key}Json`]) || '[]'); } catch { throw httpError(400, `Invalid ${key}Json`); }
      if (!Array.isArray(parsed)) throw httpError(400, `${key}Json must be a JSON array`);
      f[key] = parseIdList(key, parsed);
    } else if (has(body, key)) {
      f[key] = parseIdList(key, body[key]);
    }
  }
  if (has(body, 'video') && typeof body.video === 'string') f.video = toStr(body.video); // '' clears it
  return f;
};

const getItemsWithQuery = async (query, { page, limit, skip }) => {
  const [items, total] = await Promise.all([
    Item.find(query).populate(POPULATE_OPTIONS).skip(skip).limit(limit).sort({ createdAt: -1 }),
    Item.countDocuments(query),
  ]);
  return { success: true, items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

exports.getItems = asyncHandler(async (req, res) => {
  res.json(await getItemsWithQuery(PUBLIC_FILTER, parsePagination(req.query, CATALOG_PAGINATION)));
});

exports.getAdminItems = asyncHandler(async (req, res) => {
  res.json(await getItemsWithQuery({}, parsePagination(req.query, CATALOG_PAGINATION)));
});

exports.getItemById = asyncHandler(async (req, res) => {
  const item = await Item.findById(toStr(req.params.id)).populate(POPULATE_OPTIONS);
  if (!item || item.stockQty <= 0 || item.status === 'inactive') {
    throw httpError(404, 'Item not found or out of stock');
  }
  res.json({ success: true, item });
});

exports.getAdminItemById = asyncHandler(async (req, res) => {
  const item = await Item.findById(toStr(req.params.id)).populate(POPULATE_OPTIONS);
  if (!item) throw httpError(404, 'Item not found');
  res.json({ success: true, item });
});

exports.getItemsByCategory = asyncHandler(async (req, res) => {
  const id = toStr(req.params.categoryId);
  if (!isValidId(id)) throw httpError(400, 'Invalid category id');
  const items = await Item.find({ categories: id, ...PUBLIC_FILTER }).populate(POPULATE_OPTIONS).limit(1000);
  res.json({ success: true, items });
});

exports.getItemsBySubcategory = asyncHandler(async (req, res) => {
  const id = toStr(req.params.subcategoryId);
  if (!isValidId(id)) throw httpError(400, 'Invalid subcategory id');
  const items = await Item.find({ subcategories: id, ...PUBLIC_FILTER }).populate(POPULATE_OPTIONS).limit(1000);
  res.json({ success: true, items });
});

exports.getFeaturedItems = asyncHandler(async (req, res) => {
  const typeMap = { bestseller: 'isBestSeller', bestrated: 'isBestRated', onsale: 'isOnSale', popular: 'isPopular' };
  const field = typeMap[toStr(req.params.type)];
  if (!field) throw httpError(400, 'Invalid type');
  const items = await Item.find({ [field]: true, ...PUBLIC_FILTER }).populate(POPULATE_OPTIONS).limit(1000);
  res.json({ success: true, items });
});

exports.createItem = asyncHandler(async (req, res) => {
  const fields = buildItemFields(req.body);
  if (!fields.name) throw httpError(400, 'name is required');
  if (fields.price == null) throw httpError(400, 'price is required');
  if (!fields.categories?.length) throw httpError(400, 'At least one category is required');
  const uploads = await uploadFiles(req.files); // 502 on failure — nothing is saved
  const item = await new Item({ ...fields, ...uploads }).save();
  res.status(201).json({ success: true, item });
});

// Load + assign + save so schema validators (incl. images ≤ 3) run in document context.
exports.updateItem = asyncHandler(async (req, res) => {
  const id = toStr(req.params.id);
  if (!isValidId(id)) throw httpError(400, 'Invalid item id');
  const item = await Item.findById(id);
  if (!item) throw httpError(404, 'Item not found');

  const fields = buildItemFields(req.body);
  const uploads = await uploadFiles(req.files);
  item.set({ ...fields, ...uploads });
  await item.save();
  await item.populate(POPULATE_OPTIONS);
  res.json({ success: true, item });
});

exports.deleteItem = asyncHandler(async (req, res) => {
  const item = await Item.findByIdAndDelete(toStr(req.params.id));
  if (!item) throw httpError(404, 'Item not found');
  res.json({ success: true, message: 'Item deleted successfully' });
});
