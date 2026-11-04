const mongoose = require('mongoose');

// Singleton store settings (key: 'main'). Defaults reproduce the pre-settings behaviour.
// `checkout.minOrderValue` / `checkout.platformFeePercent` default to null = "unset", in which case
// the env vars (MIN_ORDER_VALUE / PLATFORM_FEE_PERCENT) and then 100 / 2 apply.
const S = mongoose.Schema;

const settingsSchema = new S({
  key: { type: String, default: 'main', unique: true },
  business: {
    name: { type: String, default: 'Chowdhry Sweet House' },
    tagline: { type: String, default: 'Love at First Bite' },
    legalName: { type: String, default: '' },
    address: {
      line1: { type: String, default: 'Vijay Chowk, in front of Vijay Talkies, Golghar' },
      line2: { type: String, default: '' },
      city: { type: String, default: 'Gorakhpur' },
      state: { type: String, default: 'Uttar Pradesh' },
      postcode: { type: String, default: '273001' },
      country: { type: String, default: 'India' },
    },
    phone: { type: String, default: '7525025100' },
    whatsapp: { type: String, default: '7525025100' },
    email: { type: String, default: '' },
    openingHours: { type: String, default: '' },
    mapUrl: { type: String, default: '' },
  },
  social: {
    instagram: { type: String, default: 'https://www.instagram.com/chowdhry_sweet_house/' },
    facebook: { type: String, default: '' },
    youtube: { type: String, default: '' },
    googleReviews: { type: String, default: '' },
  },
  legal: {
    gstin: { type: String, default: '' },
    gstScheme: { type: String, enum: ['regular', 'composition', 'unregistered'], default: 'regular' },
    pan: { type: String, default: '' },
    fssaiLicense: { type: String, default: '' },
    fssaiValidTill: { type: Date, default: null },
    grievanceOfficer: {
      name: { type: String, default: '' },
      designation: { type: String, default: 'Grievance Officer' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    invoicePrefix: { type: String, default: 'CSH' },
    showFssaiOnSite: { type: Boolean, default: true },
  },
  checkout: {
    minOrderValue: { type: Number, default: null },
    platformFeePercent: { type: Number, default: null },
    pricesIncludeGst: { type: Boolean, default: false },
    defaultGstRate: { type: Number, default: 5 },
    defaultHsn: { type: String, default: '2106' },
    orderingEnabled: { type: Boolean, default: true },
    orderingPausedMessage: { type: String, default: '' },
  },
  delivery: {
    localFreeAboveAmount: { type: Number, default: 0 },
    localFallbackFee: { type: Number, default: null }, // null → LOCAL_DELIVERY_FALLBACK_FEE env → 100
    sameDayCutoff: { type: String, default: '17:00' },
    deliveryNote: { type: String, default: '' },
  },
  // Values used in the default policy pages.
  policies: {
    cancellationWindow: { type: String, default: 'before the order is dispatched' },
    refundProcessingDays: { type: Number, default: 7 },
    returnNote: { type: String, default: '' },
  },
  notifications: {
    orderAlertEmail: { type: String, default: '' },
    orderAlertWhatsapp: { type: String, default: '' },
  },
  // Never exposed publicly.
  internal: {
    notes: { type: String, default: '' },
  },
  updatedBy: { type: S.Types.ObjectId, ref: 'user' },
  settingsHistory: [{
    _id: false,
    section: String,
    by: { type: S.Types.ObjectId, ref: 'user' },
    at: { type: Date, default: Date.now },
  }],
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('Settings', settingsSchema);
