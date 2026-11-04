/**
 * Store settings: cached singleton (≈60s per instance), validation, effective values,
 * brand/legal view for emails & invoices, and {{placeholder}} resolution for CMS pages.
 */
const Settings = require('../models/Settings');
const { BRAND } = require('../config/site');
const { httpError } = require('../utils/http');
const { canonicalState, normalizePhone } = require('../utils/addressValidation');

const CACHE_MS = 60 * 1000;
let cache = null; // { at, doc }
let inflight = null;

const loadFresh = async () => {
  const doc = await Settings.findOneAndUpdate(
    { key: 'main' },
    { $setOnInsert: { key: 'main' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  cache = { at: Date.now(), doc };
  return doc;
};

// Plain object with defaults applied. Falls back to schema defaults if the DB is unavailable.
const getSettings = async ({ fresh = false } = {}) => {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.doc;
  if (!inflight) inflight = loadFresh().finally(() => { inflight = null; });
  try {
    return await inflight;
  } catch (e) {
    if (cache) return cache.doc;
    return new Settings().toObject();
  }
};

const invalidateSettings = () => { cache = null; };

/* ----------------------------- Effective values ---------------------------- */

const numOr = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
};

const effectiveCheckout = (s) => ({
  minOrderValue: numOr(s.checkout?.minOrderValue, process.env.MIN_ORDER_VALUE, 100),
  platformFeePercent: numOr(s.checkout?.platformFeePercent, process.env.PLATFORM_FEE_PERCENT, 2),
  pricesIncludeGst: s.checkout?.pricesIncludeGst === true,
  defaultGstRate: numOr(s.checkout?.defaultGstRate, 5),
  defaultHsn: s.checkout?.defaultHsn || '2106',
  orderingEnabled: s.checkout?.orderingEnabled !== false,
  orderingPausedMessage: s.checkout?.orderingPausedMessage || '',
  gstScheme: s.legal?.gstScheme || 'regular',
});

const effectiveDelivery = (s) => ({
  localFreeAboveAmount: numOr(s.delivery?.localFreeAboveAmount, 0),
  localFallbackFee: numOr(s.delivery?.localFallbackFee, process.env.LOCAL_DELIVERY_FALLBACK_FEE, 100),
  sameDayCutoff: s.delivery?.sameDayCutoff || '17:00',
  deliveryNote: s.delivery?.deliveryNote || '',
});

// Public subset: everything except `internal`, `notifications`, audit fields and PAN.
const publicSettings = (s) => {
  const { internal, notifications, settingsHistory, updatedBy, _id, __v, key, createdAt, ...rest } = s;
  const { pan, ...legal } = rest.legal || {};
  return {
    ...rest,
    legal,
    checkout: { ...rest.checkout, ...effectiveCheckout(s) },
    delivery: { ...rest.delivery, ...effectiveDelivery(s) },
  };
};

/* -------------------------------- Brand view ------------------------------- */

const formatAddress = (a = {}) => [a.line1, a.line2, a.city, a.state, a.postcode].filter(Boolean).join(', ');

// What emails / invoices need, with config/site.js BRAND as the fallback for blanks.
const brandFromSettings = (s = {}) => {
  const b = s.business || {};
  const phone = normalizePhone(b.phone) || BRAND.phoneTel.replace('+91', '');
  const wa = normalizePhone(b.whatsapp) || phone;
  const g = s.legal?.grievanceOfficer || {};
  return {
    name: b.name || BRAND.name,
    legalName: b.legalName || b.name || BRAND.name,
    tagline: b.tagline || BRAND.tagline,
    address: formatAddress(b.address) || BRAND.city,
    city: [b.address?.city, b.address?.state].filter(Boolean).join(', ') || BRAND.city,
    state: canonicalState(b.address?.state) || b.address?.state || 'Uttar Pradesh',
    phoneDisplay: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
    phoneTel: `+91${phone}`,
    whatsapp: `https://wa.me/91${wa}`,
    email: b.email || '',
    instagram: s.social?.instagram || BRAND.instagram,
    facebook: s.social?.facebook || '',
    youtube: s.social?.youtube || '',
    gstin: s.legal?.gstin || '',
    gstScheme: s.legal?.gstScheme || 'regular',
    fssaiLicense: s.legal?.fssaiLicense || '',
    grievance: { name: g.name || '', designation: g.designation || 'Grievance Officer', email: g.email || '', phone: g.phone || '' },
    colors: BRAND.colors,
  };
};

/* -------------------------------- Validation ------------------------------- */

const URL_RE = /^https:\/\/[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
// GSTIN 15th character is a base-36 checksum of the first 14 (same algorithm as the admin form).
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstinChecksumOk = (v) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(v[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === v[14];
};
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

const str = (max) => (v) => (typeof v === 'string' && v.trim().length <= max ? [true, v.trim()] : [false, `Must be text up to ${max} characters`]);
const optional = (re, msg, transform = (x) => x) => (v) => {
  if (v === '' || v == null) return [true, ''];
  if (typeof v !== 'string') return [false, msg];
  const t = transform(v.trim());
  return re.test(t) ? [true, t] : [false, msg];
};
const bool = (v) => (typeof v === 'boolean' ? [true, v] : v === 'true' || v === 'false' ? [true, v === 'true'] : [false, 'Must be true or false']);
const num = (min, max, { nullable = false } = {}) => (v) => {
  if (nullable && (v === null || v === '')) return [true, null];
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? [true, n] : [false, `Must be a number between ${min} and ${max}`];
};
const oneOf = (list) => (v) => (list.includes(v) ? [true, v] : [false, `Must be one of: ${list.join(', ')}`]);
const phoneOpt = (v) => {
  if (v === '' || v == null) return [true, ''];
  const p = normalizePhone(v);
  return p ? [true, p] : [false, 'Enter a valid 10-digit Indian mobile number'];
};
const stateOpt = (v) => {
  if (v === '' || v == null) return [true, ''];
  const st = canonicalState(v);
  return st ? [true, st] : [false, 'Select a valid Indian state / union territory'];
};
const dateOpt = (v) => {
  if (v === '' || v == null) return [true, null];
  const d = new Date(v);
  return isNaN(d.getTime()) ? [false, 'Invalid date'] : [true, d];
};

const RULES = {
  business: {
    name: (v) => (typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= 100 ? [true, v.trim()] : [false, 'Business name must be 2–100 characters']),
    tagline: str(100),
    legalName: str(150),
    'address.line1': str(150),
    'address.line2': str(150),
    'address.city': str(60),
    'address.state': stateOpt,
    'address.postcode': optional(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit pincode'),
    'address.country': str(60),
    phone: phoneOpt,
    whatsapp: phoneOpt,
    email: optional(EMAIL_RE, 'Enter a valid email', (x) => x.toLowerCase()),
    openingHours: str(200),
    mapUrl: optional(URL_RE, 'Must be an https:// link'),
  },
  social: {
    instagram: optional(URL_RE, 'Must be an https:// link'),
    facebook: optional(URL_RE, 'Must be an https:// link'),
    youtube: optional(URL_RE, 'Must be an https:// link'),
    googleReviews: optional(URL_RE, 'Must be an https:// link'),
  },
  legal: {
    gstin: (v) => {
      const [ok, out] = optional(GSTIN_RE, 'Enter a valid 15-character GSTIN', (x) => x.toUpperCase())(v);
      if (!ok || !out) return [ok, out];
      return gstinChecksumOk(out) ? [true, out] : [false, 'GSTIN check digit does not match — please re-check it'];
    },
    gstScheme: oneOf(['regular', 'composition', 'unregistered']),
    pan: optional(PAN_RE, 'Enter a valid PAN', (x) => x.toUpperCase()),
    fssaiLicense: optional(/^\d{14}$/, 'FSSAI licence number must be 14 digits'),
    fssaiValidTill: dateOpt,
    'grievanceOfficer.name': str(100),
    'grievanceOfficer.designation': str(100),
    'grievanceOfficer.email': optional(EMAIL_RE, 'Enter a valid email', (x) => x.toLowerCase()),
    'grievanceOfficer.phone': phoneOpt,
    invoicePrefix: (v) => (typeof v === 'string' && /^[A-Z0-9-]{1,10}$/.test(v.trim().toUpperCase()) ? [true, v.trim().toUpperCase()] : [false, 'Prefix must be 1–10 letters/digits/hyphens']),
    showFssaiOnSite: bool,
  },
  checkout: {
    minOrderValue: num(0, 100000, { nullable: true }),
    platformFeePercent: num(0, 10, { nullable: true }),
    pricesIncludeGst: bool,
    defaultGstRate: (v) => ([0, 5, 12, 18, 28].includes(Number(v)) ? [true, Number(v)] : [false, 'GST rate must be 0, 5, 12, 18 or 28']),
    defaultHsn: optional(/^\d{4,8}$/, 'HSN must be 4–8 digits'),
    orderingEnabled: bool,
    orderingPausedMessage: str(300),
  },
  delivery: {
    localFreeAboveAmount: num(0, 100000),
    localFallbackFee: num(0, 1000, { nullable: true }),
    sameDayCutoff: optional(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)'),
    deliveryNote: str(300),
  },
  policies: {
    cancellationWindow: str(200),
    refundProcessingDays: num(1, 60),
    returnNote: str(1000),
  },
  notifications: {
    orderAlertEmail: optional(EMAIL_RE, 'Enter a valid email', (x) => x.toLowerCase()),
    orderAlertWhatsapp: phoneOpt,
  },
  internal: {
    notes: str(5000),
  },
};
const SECTIONS = Object.keys(RULES);

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Validates the present fields of `data` for `section`. Returns the $set map. Throws 400 with fieldErrors.
const buildSectionUpdate = (section, data) => {
  if (!SECTIONS.includes(section)) throw httpError(400, `section must be one of: ${SECTIONS.join(', ')}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw httpError(400, 'data must be an object');
  const rules = RULES[section];
  const set = {};
  const fieldErrors = {};
  for (const [path, rule] of Object.entries(rules)) {
    const v = getPath(data, path);
    if (v === undefined) continue;
    const [ok, out] = rule(v);
    if (ok) set[`${section}.${path}`] = out;
    else fieldErrors[`${section}.${path}`] = out; // dotted path, e.g. "legal.gstin"
  }
  if (Object.keys(fieldErrors).length) {
    throw httpError(400, Object.values(fieldErrors)[0], { code: 'INVALID_SETTINGS', fieldErrors });
  }
  return set;
};

const updateSection = async (section, data, by) => {
  const set = buildSectionUpdate(section, data);
  const doc = await Settings.findOneAndUpdate(
    { key: 'main' },
    {
      $set: { ...set, updatedBy: by },
      $push: { settingsHistory: { $each: [{ section, by, at: new Date() }], $slice: -50 } },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  cache = { at: Date.now(), doc };
  return doc;
};

/* ------------------------------- Placeholders ------------------------------ */

const placeholderContext = (s) => {
  const brand = brandFromSettings(s);
  const c = effectiveCheckout(s);
  const d = effectiveDelivery(s);
  return {
    business: {
      ...(s.business || {}),
      name: brand.name,
      legalName: brand.legalName,
      address: brand.address, // formatted one line
      city: s.business?.address?.city || '',
      state: s.business?.address?.state || '',
      phone: brand.phoneDisplay,
      whatsapp: brand.whatsapp,
    },
    social: s.social || {},
    legal: { ...(s.legal || {}), pan: undefined, legalName: brand.legalName, grievanceOfficer: { ...brand.grievance } },
    checkout: c,
    delivery: d,
    policies: s.policies || {},
    site: { url: require('../config/site').frontendUrl() },
  };
};

// Replace {{a.b.c}} with values from settings. Missing/blank → "[to be updated]".
const resolvePlaceholders = (text, s) => {
  const ctx = placeholderContext(s);
  return String(text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, path) => {
    const v = getPath(ctx, path);
    if (v === undefined || v === null || v === '') return '[to be updated]';
    return String(v);
  });
};

module.exports = {
  getSettings,
  invalidateSettings,
  effectiveCheckout,
  effectiveDelivery,
  publicSettings,
  brandFromSettings,
  buildSectionUpdate,
  updateSection,
  resolvePlaceholders,
  SECTIONS,
};
