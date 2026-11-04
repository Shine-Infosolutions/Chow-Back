const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  }],
  subcategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subcategory'
  }],
  price: {
    type: Number,
    required: true
  },
  discountPrice: {
    type: Number
  },
  stockQty: {
    type: Number,
    required: true,
    default: 0
  },
  shortDesc: {
    type: String,
    required: true
  },
  longDesc: {
    type: String
  },
  // Array-level validator: works for save() and for update queries with runValidators
  // (the old per-element validator read `this.images`, which is undefined in query context).
  images: {
    type: [String],
    validate: {
      validator: (v) => !v || v.length <= 3,
      message: 'Maximum 3 images allowed'
    }
  },
  video: {
    type: String
  },
  isBestRated: {
    type: Boolean,
    default: false
  },
  isBestSeller: {
    type: Boolean,
    default: false
  },
  isOnSale: {
    type: Boolean,
    default: false
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  weight: {
    type: Number,
    required: true,
    min: 1,
    default: 100 // Default weight in grams
  },
  uom: {
    type: String,
    enum: ['kg', 'gm', 'ltr', 'ml', 'pcs', 'box', 'pack'],
    default: 'gm'
  },
  piecesPerUnit: {
    type: Number,
    min: 1,
    default: 1 // For items sold by pieces (e.g., 12 pieces per box)
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  // ---- Food information (FSSAI labelling) ----
  foodType: { type: String, enum: ['veg', 'egg', 'nonveg'], default: 'veg' },
  ingredients: { type: String, default: '' },
  allergens: {
    type: [{ type: String, enum: ['milk', 'nuts', 'gluten', 'soy', 'sesame', 'egg'] }],
    default: []
  },
  shelfLifeDays: { type: Number, min: 0 },
  storageInstructions: { type: String, default: '' },
  bestBeforeNote: { type: String, default: '' },
  netWeight: { type: String, default: '' }, // display text, e.g. "500 g"
  hsnCode: { type: String, default: '' },   // falls back to settings.checkout.defaultHsn
  gstRate: { type: Number, default: null },  // falls back to settings.checkout.defaultGstRate
  countryOfOrigin: { type: String, default: 'India' },
  // Perishables default to local delivery only; courier (Delhivery) orders need shippable:true.
  shippable: { type: Boolean, default: false }
}, {
  timestamps: true
});

itemSchema.index({ categories: 1 });
itemSchema.index({ subcategories: 1 });
itemSchema.index({ status: 1, stockQty: 1 });

module.exports = mongoose.model('Item', itemSchema);