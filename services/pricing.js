/**
 * Order pricing from Settings.
 *  - gstScheme 'composition' | 'unregistered' → no GST charged or shown.
 *  - 'regular' + pricesIncludeGst:false (default) → GST added on top (per-line rate, default 5%).
 *  - 'regular' + pricesIncludeGst:true → prices already include GST; GST is extracted for the
 *    invoice breakup and never added.
 *  - Platform fee = ceil((subtotal + GST added + shipping) × pct / 100); 0 when pct is 0.
 * With default settings this reproduces the original formula exactly.
 */
const { round2 } = require('../utils/http');
const { effectiveCheckout } = require('./settings');

const lineRate = (line, eff) => {
  const r = Number(line.gstRate);
  return Number.isFinite(r) && r >= 0 ? r : eff.defaultGstRate;
};

const computePricing = ({ lines, shipping = 0, settings }) => {
  const eff = effectiveCheckout(settings || {});
  const scheme = eff.gstScheme;
  const taxable = scheme === 'regular';
  const inclusive = taxable && eff.pricesIncludeGst;

  const subtotal = round2(lines.reduce((s, l) => s + l.price * l.quantity, 0));
  let gst = 0;
  if (taxable) {
    gst = lines.reduce((s, l) => {
      const lt = l.price * l.quantity;
      const rate = lineRate(l, eff);
      return s + (inclusive ? (lt * rate) / (100 + rate) : (lt * rate) / 100);
    }, 0);
  }
  gst = round2(gst);
  const gstAdded = taxable && !inclusive ? gst : 0;
  const pct = eff.platformFeePercent;
  const platformFee = pct > 0 ? Math.ceil(((subtotal + gstAdded + shipping) * pct) / 100) : 0;
  const total = round2(subtotal + gstAdded + shipping + platformFee);

  return {
    subtotal,
    gst,
    gstIncluded: inclusive,
    gstScheme: scheme,
    shipping: round2(shipping),
    platformFee,
    platformFeePercent: pct,
    total,
  };
};

module.exports = { computePricing, lineRate };
