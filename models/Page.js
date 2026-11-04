const mongoose = require('mongoose');

const SLUGS = ['privacy-policy', 'terms', 'refund-policy', 'shipping-policy', 'cancellation-policy', 'about', 'contact'];

// CMS page (markdown). `{{placeholders}}` are resolved from Settings when served publicly.
const pageSchema = new mongoose.Schema({
  slug: { type: String, enum: SLUGS, required: true, unique: true },
  title: { type: String, required: true },
  content: { type: String, default: '' },
  published: { type: Boolean, default: true },
  // true for the shipped default template until an admin saves it ("review before use").
  isTemplate: { type: Boolean, default: false },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
}, { timestamps: true });

pageSchema.statics.SLUGS = SLUGS;

module.exports = mongoose.model('Page', pageSchema);
