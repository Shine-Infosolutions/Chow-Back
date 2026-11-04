const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Blank/null emails are stored as "missing" (field omitted) so the sparse unique index ignores
// them — a stored `null` WOULD be indexed and collide between guests.
const normaliseEmail = (v) => {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  return s === '' ? undefined : s;
};

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    required: function() { return !this.isGuest; },
    default: function() { return this.isGuest ? 'Guest' : undefined; }
  },
  // Unique among users that HAVE an email (guests have none).
  // One-off index change on existing DBs: scripts/migrateEmailIndexSparse.js
  email: {
    type: String,
    set: normaliseEmail,
    required: function() { return !this.isGuest; }
  },
  password: {
    type: String,
    required: function() { return !this.isGuest; }
  },
  // Normalised 10-digit Indian mobile.
  phone: {
    type: String,
    required: true
  },
  // Mobile-only guest checkout account (no email/password). Converted via POST /auth/claim.
  isGuest: {
    type: Boolean,
    default: false
  },
  // Bumped to revoke every issued token (account deletion). JWTs carry it as `tv`.
  tokenVersion: { type: Number, default: 0 },
  // DPDP erasure: personal data stripped, orders kept for GST record retention.
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  address: [{
    addressType: { type: String, default: 'home' },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    street: { type: String, required: true },
    apartment: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postcode: { type: String, required: true },
    email: { type: String },
    phone: { type: String, required: true },
    altPhone: { type: String },
    orderNotes: { type: String },
    isDefault: { type: Boolean, default: false }
  }],
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 });

userSchema.pre('save', async function(next) {
  if (!this.password || !this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Always false for accounts without a password (guests).
userSchema.methods.comparePassword = async function(password) {
  if (!this.password || typeof password !== 'string' || !password) return false;
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('user', userSchema);
