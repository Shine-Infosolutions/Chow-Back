// Shared address + phone validation (server is authoritative; the storefront mirrors these rules).
// Invalid → 400 { success:false, code:'INVALID_ADDRESS', message, fieldErrors:{ field: message } }.
const axios = require('axios');
const { httpError } = require('./http');
const { isGorakhpurPincode } = require('../config/gorakhpurPincodes');

/* ------------------------------ States / UTs ------------------------------ */

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];
const UNION_TERRITORIES = [
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];
const STATES_AND_UTS = [...INDIAN_STATES, ...UNION_TERRITORIES];

const stateKey = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STATE_ALIASES = {
  up: 'Uttar Pradesh',
  orissa: 'Odisha',
  pondicherry: 'Puducherry',
  uttaranchal: 'Uttarakhand',
  chattisgarh: 'Chhattisgarh',
  'nct of delhi': 'Delhi',
  'new delhi': 'Delhi',
  'delhi nct': 'Delhi',
  'jandk': 'Jammu and Kashmir',
  'j and k': 'Jammu and Kashmir',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'andaman and nicobar': 'Andaman and Nicobar Islands',
  'andaman nicobar islands': 'Andaman and Nicobar Islands',
};
const STATE_LOOKUP = new Map(STATES_AND_UTS.map((s) => [stateKey(s), s]));
Object.entries(STATE_ALIASES).forEach(([k, v]) => STATE_LOOKUP.set(stateKey(k), v));

// Canonical state/UT name or null.
const canonicalState = (s) => STATE_LOOKUP.get(stateKey(s)) || null;

/* --------------------------------- Phones --------------------------------- */

// Normalise an Indian mobile to 10 digits (strip +91 / 91 / 0 / spaces / dashes). null if invalid.
const normalizePhone = (v) => {
  if (v == null) return null;
  let s = String(v).replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (/^91\d{10}$/.test(s)) s = s.slice(2);
  else if (/^0\d{10}$/.test(s)) s = s.slice(1);
  if (!/^[6-9]\d{9}$/.test(s)) return null;
  if (/^(\d)\1{9}$/.test(s)) return null; // 9999999999
  return s;
};

/* ------------------------------ Text heuristics --------------------------- */

const clean = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

const MASH_SUBSTRINGS = ['asdf', 'qwer', 'zxcv', 'hjkl'];
const MASH_WORDS = ['test'];
const MASH_WHOLE = ['abc', 'xyz', 'na', 'n/a', 'null', 'none', 'nothing', '.', '-', 'undefined'];
// Common Indian address abbreviations that legitimately have no vowels.
const NO_VOWEL_OK = new Set(['bldg', 'chwk', 'hwys', 'mrkt', 'pvt', 'ltd']);

// Returns an error message or null.
const garbageCheck = (value) => {
  const v = value.toLowerCase();
  if (MASH_WHOLE.includes(v)) return 'Please enter a real value';
  if (/(.)\1{3,}/u.test(v)) return 'Too many repeated characters';
  if (MASH_SUBSTRINGS.some((m) => v.includes(m))) return 'Please enter a real value';
  const words = v.split(/[^\p{L}]+/u).filter(Boolean);
  if (words.some((w) => MASH_WORDS.includes(w))) return 'Please enter a real value';
  if (words.some((w) => w.length > 25)) return 'Contains an unusually long word';
  // Only Latin words are checked for vowels (Devanagari etc. pass).
  if (words.some((w) => /^[a-z]+$/.test(w) && w.length > 3 && !/[aeiouy]/.test(w) && !NO_VOWEL_OK.has(w))) {
    return 'Please enter a real value';
  }
  return null;
};

const NAME_RE = /^[\p{L} .'-]+$/u;
const CITY_RE = /^[\p{L} ]+$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

/* ----------------------------- Pincode lookup ----------------------------- */

const PIN_CACHE = new Map(); // pin → { at, data }
const PIN_CACHE_TTL = 24 * 60 * 60 * 1000;
const PIN_CACHE_MAX = 2000;

// India Post lookup. Returns
//   { found:true, district, state, places:[...] } | { found:false } | null (lookup unavailable)
const lookupPincode = async (pin) => {
  if (!PIN_RE.test(String(pin || ''))) return { found: false };
  const hit = PIN_CACHE.get(pin);
  if (hit && Date.now() - hit.at < PIN_CACHE_TTL) return hit.data;
  try {
    const { data } = await axios.get(`https://api.postalpincode.in/pincode/${pin}`, {
      timeout: 3000,
      headers: { 'User-Agent': 'ChowApp/1.0' },
    });
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry || !entry.Status) return null;
    let result;
    if (entry.Status === 'Success' && Array.isArray(entry.PostOffice) && entry.PostOffice.length) {
      const po = entry.PostOffice;
      result = {
        found: true,
        district: po[0].District || '',
        state: canonicalState(po[0].State) || po[0].State || '',
        places: [...new Set(po.flatMap((p) => [p.Name, p.Block, p.Division, p.District, p.Region]).filter(Boolean))],
      };
    } else if (entry.Status === 'Error' || entry.Status === '404') {
      result = { found: false };
    } else {
      return null;
    }
    if (PIN_CACHE.size >= PIN_CACHE_MAX) PIN_CACHE.delete(PIN_CACHE.keys().next().value);
    PIN_CACHE.set(pin, { at: Date.now(), data: result });
    return result;
  } catch {
    return null; // API down / timeout → never block
  }
};

/* ------------------------------- Validation ------------------------------- */

const ADDRESS_FIELDS = ['addressType', 'firstName', 'lastName', 'street', 'apartment', 'city', 'state', 'postcode', 'email', 'phone', 'altPhone', 'orderNotes', 'isDefault'];

/**
 * Validate + normalise an address. `input` should already be the merged full address
 * (for partial updates merge the existing subdoc first).
 * Returns { value, fieldErrors, lookup }.
 */
const validateAddress = async (input = {}, { lookup = true } = {}) => {
  const fe = {};
  const v = {};

  v.addressType = clean(input.addressType) || 'home';
  if (v.addressType.length > 20 || !/^[\p{L} ]+$/u.test(v.addressType)) fe.addressType = 'Invalid address type';

  v.firstName = clean(input.firstName);
  if (v.firstName.length < 2 || v.firstName.length > 40) fe.firstName = 'First name must be 2–40 characters';
  else if (!NAME_RE.test(v.firstName)) fe.firstName = 'First name may contain only letters, spaces, . \' -';
  else { const g = garbageCheck(v.firstName); if (g) fe.firstName = g; }

  v.lastName = clean(input.lastName);
  if (v.lastName.length < 1 || v.lastName.length > 40) fe.lastName = 'Last name must be 1–40 characters';
  else if (!NAME_RE.test(v.lastName)) fe.lastName = 'Last name may contain only letters, spaces, . \' -';
  else if (v.lastName.length > 1) { const g = garbageCheck(v.lastName); if (g) fe.lastName = g; }

  v.street = clean(input.street);
  const streetLetters = (v.street.match(/\p{L}/gu) || []).length;
  if (v.street.length < 8 || v.street.length > 150) fe.street = 'Street address must be 8–150 characters';
  else if (v.street.split(' ').filter(Boolean).length < 2 || streetLetters < 4) fe.street = 'Please enter a complete street address';
  else { const g = garbageCheck(v.street); if (g) fe.street = g; }

  v.apartment = clean(input.apartment);
  if (v.apartment.length > 100) fe.apartment = 'Apartment must be at most 100 characters';

  v.city = clean(input.city);
  if (v.city.length < 2 || v.city.length > 50) fe.city = 'City must be 2–50 characters';
  else if (!CITY_RE.test(v.city)) fe.city = 'City may contain only letters and spaces';
  else { const g = garbageCheck(v.city); if (g) fe.city = g; }

  const st = canonicalState(input.state);
  v.state = st || clean(input.state);
  if (!st) fe.state = 'Select a valid Indian state / union territory';

  v.postcode = clean(input.postcode).replace(/\s/g, '');
  if (!PIN_RE.test(v.postcode)) fe.postcode = 'Enter a valid 6-digit pincode';

  v.email = clean(input.email).toLowerCase();
  if (v.email && (!EMAIL_RE.test(v.email) || v.email.length > 254)) fe.email = 'Enter a valid email address';

  const phone = normalizePhone(input.phone);
  if (!phone) fe.phone = 'Enter a valid 10-digit Indian mobile number';
  v.phone = phone || clean(input.phone);

  const rawAlt = clean(input.altPhone);
  if (rawAlt) {
    const alt = normalizePhone(rawAlt);
    if (!alt) fe.altPhone = 'Enter a valid 10-digit Indian mobile number';
    else if (alt === phone) fe.altPhone = 'Alternate number must differ from the phone number';
    v.altPhone = alt || rawAlt;
  } else {
    v.altPhone = '';
  }

  v.orderNotes = clean(input.orderNotes).slice(0, 300);
  v.isDefault = input.isDefault === true || input.isDefault === 'true';

  let pin = null;
  if (lookup && !fe.postcode) {
    pin = await lookupPincode(v.postcode);
    if (pin && pin.found === false) {
      fe.postcode = 'This pincode does not exist';
    } else if (pin && pin.found) {
      if (st && pin.state && canonicalState(pin.state) && canonicalState(pin.state) !== st) {
        fe.state = `Pincode ${v.postcode} belongs to ${pin.state}`;
      }
      if (!fe.city) {
        const c = v.city.toLowerCase();
        const matches = pin.places.some((p) => String(p).toLowerCase() === c) || (pin.district || '').toLowerCase() === c;
        if (!matches && pin.district) v.city = clean(pin.district);
      }
    }
  }

  return { value: v, fieldErrors: fe, lookup: pin };
};

const invalidAddressError = (fieldErrors) =>
  httpError(400, Object.values(fieldErrors)[0] || 'Invalid address', { code: 'INVALID_ADDRESS', fieldErrors });

// Validate or throw 400 INVALID_ADDRESS. Returns the normalised address.
const assertValidAddress = async (input, opts) => {
  const { value, fieldErrors } = await validateAddress(input, opts);
  if (Object.keys(fieldErrors).length) throw invalidAddressError(fieldErrors);
  return value;
};

// GET /api/address/pincode/:pincode payload.
const describePincode = async (pincode) => {
  const pin = String(pincode || '').trim();
  if (!PIN_RE.test(pin)) return { success: true, valid: false, city: null, district: null, state: null, serviceable: false };
  const info = await lookupPincode(pin);
  const serviceable = isGorakhpurPincode(pin);
  if (!info) {
    // Lookup unavailable: format is valid, details unknown.
    return { success: true, valid: true, city: null, district: null, state: null, serviceable, lookupUnavailable: true };
  }
  if (!info.found) return { success: true, valid: false, city: null, district: null, state: null, serviceable: false };
  return { success: true, valid: true, city: info.district, district: info.district, state: info.state, serviceable };
};

module.exports = {
  INDIAN_STATES,
  UNION_TERRITORIES,
  STATES_AND_UTS,
  ADDRESS_FIELDS,
  canonicalState,
  normalizePhone,
  garbageCheck,
  lookupPincode,
  validateAddress,
  assertValidAddress,
  invalidAddressError,
  describePincode,
};
