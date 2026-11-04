const mongoose = require('mongoose');

// Atomic sequences, e.g. _id 'invoice:2026-27' / 'creditnote:2026-27'.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
}, { versionKey: false });

module.exports = mongoose.model('Counter', counterSchema);
