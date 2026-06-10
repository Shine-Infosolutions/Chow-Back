const mongoose = require('mongoose');

// One document per browser/device push endpoint. Tied to the logged-in user so we
// can target "this customer" or "all admins". Keyed by endpoint (unique) so the same
// device re-subscribing just updates its record instead of creating duplicates.
const pushSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
    index: true
  },
  // Denormalised so we can fan out to admins without a join on every send.
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    index: true
  },
  endpoint: {
    type: String,
    required: true,
    unique: true
  },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  userAgent: { type: String }
}, {
  timestamps: true
});

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
