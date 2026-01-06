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
  images: [{
    type: String,
    validate: {
      validator: function(v) {
        return this.images.length <= 3;
      },
      message: 'Maximum 3 images allowed'
    }
  }],
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
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Item', itemSchema);