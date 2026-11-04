// Invoice / order presentation helpers.
// getInvoiceData(order) → normalised numbers used by the invoice page and the emails.
// renderInvoiceHtml(order, brand) → printable Tax Invoice (regular GST) or Bill of Supply
// (composition / unregistered). `brand` comes from services/settings.brandFromSettings().
// Every interpolated value is HTML-escaped.

const { escapeHtml: e, round2 } = require('./http');
const { canonicalState } = require('./addressValidation');

const PRIMARY = '#d80a4e';

const LOGO_URL = () => process.env.LOGO_URL || `${require('../config/site').frontendUrl()}/logo.png`;

const rupee = (n) => `₹${Number(n || 0).toFixed(2)}`;

const fmtDate = (d, withTime = true) => {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  } catch {
    return String(d);
  }
};

// Prefer the address snapshot captured at checkout; fall back to the user's saved address (old orders).
const getDeliveryAddress = (order) => {
  const snap = order?.shippingAddress;
  if (snap && (snap.street || snap.postcode)) return snap;
  const addresses = order?.userId?.address || [];
  return addresses.find((a) => String(a._id) === String(order.addressId)) || addresses[0] || {};
};

// Tax snapshot of an order. Legacy orders (no snapshot) were charged 5% GST on top.
const taxModelOf = (order) => ({
  scheme: order.gstScheme || 'regular',
  inclusive: order.pricesIncludeGst === true,
});

const getInvoiceData = (order) => {
  const addr = getDeliveryAddress(order);
  const { scheme, inclusive } = taxModelOf(order);
  const taxable = scheme === 'regular';

  const items = (order.items || []).map((it) => {
    const name = it.itemId?.name || it.name || 'Item';
    const qty = it.quantity || 0;
    const price = it.price || 0;
    const total = round2(price * qty);
    const rate = taxable ? (Number.isFinite(it.gstRate) ? it.gstRate : 5) : 0;
    const tax = taxable ? round2(inclusive ? (total * rate) / (100 + rate) : (total * rate) / 100) : 0;
    const taxableValue = inclusive ? round2(total - tax) : total;
    return { name, qty, price, total, rate, tax, taxableValue, hsn: it.hsnCode || '' };
  });
  const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
  const computedGst = round2(items.reduce((s, i) => s + i.tax, 0));
  const gst = taxable ? (Number.isFinite(order.gstAmount) ? order.gstAmount : computedGst) : 0;
  const delivery = order.shipping?.total || 0;
  const platformFee = order.platformFee || 0;
  const total = order.totalAmount != null ? order.totalAmount : subtotal + (inclusive ? 0 : gst) + delivery + platformFee;

  const customerName = `${addr.firstName || ''} ${addr.lastName || ''}`.trim() || order.userId?.name || 'Customer';
  const addressLine = [addr.street, addr.apartment, addr.city, addr.state, addr.postcode].filter(Boolean).join(', ');

  return {
    orderId: String(order._id),
    shortId: String(order._id).slice(-8).toUpperCase(),
    invoiceNumber: order.invoiceNumber || null,
    invoiceDate: order.invoiceDate || order.paidAt || order.confirmedAt || null,
    date: order.createdAt,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryDate: order.deliveryDate,
    customer: {
      firstName: addr.firstName || (order.userId?.name ? String(order.userId.name).trim().split(/\s+/)[0] : ''),
      name: customerName,
      email: addr.email || order.userId?.email || '',
      phone: order.contactPhone || addr.phone || order.userId?.phone || '',
      address: addressLine,
      state: canonicalState(addr.state) || addr.state || '',
    },
    items,
    subtotal,
    gst,
    gstScheme: scheme,
    gstIncluded: taxable && inclusive,
    gstLabel: !taxable ? null : inclusive ? 'GST (included)' : 'GST',
    delivery,
    platformFee,
    total,
    refundedAmount: order.refundedAmount || 0,
    refunds: order.refunds || [],
  };
};

// Per-rate GST summary: CGST+SGST when supply is intra-state, else IGST.
const taxSummary = (d, businessState) => {
  const intra = Boolean(businessState) && (canonicalState(businessState) || businessState) === d.customer.state;
  const byRate = new Map();
  for (const i of d.items) {
    if (!i.rate) continue;
    const r = byRate.get(i.rate) || { rate: i.rate, taxableValue: 0, tax: 0 };
    r.taxableValue = round2(r.taxableValue + i.taxableValue);
    r.tax = round2(r.tax + i.tax);
    byRate.set(i.rate, r);
  }
  const rows = [...byRate.values()].map((r) => (intra
    ? { ...r, cgst: round2(r.tax / 2), sgst: round2(r.tax - round2(r.tax / 2)), igst: 0 }
    : { ...r, cgst: 0, sgst: 0, igst: r.tax }));
  return { intra, rows };
};

const td = (html, extra = '') => `<td style="padding:8px;border-bottom:1px solid #f0e6d8;${extra}">${html}</td>`;

const renderInvoiceHtml = (order, brand = {}) => {
  const d = getInvoiceData(order);
  const b = {
    name: brand.name || 'Chowdhry Sweet House',
    legalName: brand.legalName || brand.name || 'Chowdhry Sweet House',
    address: brand.address || 'Gorakhpur, Uttar Pradesh',
    state: brand.state || 'Uttar Pradesh',
    phoneDisplay: brand.phoneDisplay || '',
    email: brand.email || '',
    gstin: brand.gstin || '',
    fssaiLicense: brand.fssaiLicense || '',
    grievance: brand.grievance || {},
  };
  const isTaxInvoice = d.gstScheme === 'regular';
  const docTitle = isTaxInvoice ? 'TAX INVOICE' : 'BILL OF SUPPLY';
  const declaration = d.gstScheme === 'composition'
    ? 'Composition taxable person, not eligible to collect tax on supplies.'
    : d.gstScheme === 'unregistered'
      ? 'Supplier is not registered under GST; no GST has been charged.'
      : '';
  const ts = isTaxInvoice ? taxSummary(d, b.state) : { rows: [], intra: true };

  const itemRows = d.items.map((i, idx) => `<tr>
    ${td(idx + 1)}
    ${td(e(i.name))}
    ${td(e(i.hsn || '—'), 'color:#6b7280;')}
    ${td(e(i.qty), 'text-align:center;')}
    ${td(rupee(i.price), 'text-align:right;')}
    ${isTaxInvoice ? td(`${e(i.rate)}%`, 'text-align:center;color:#6b7280;') : ''}
    ${td(rupee(i.total), 'text-align:right;font-weight:600;')}
  </tr>`).join('');
  const cols = isTaxInvoice ? 6 : 5;
  const totalRow = (label, value, strong = false) => `<tr><td colspan="${cols}" style="padding:6px 8px;text-align:right;${strong ? `font-weight:700;border-top:2px solid ${PRIMARY};` : 'color:#6b7280;'}">${e(label)}</td><td style="padding:6px 8px;text-align:right;${strong ? `font-weight:700;color:${PRIMARY};border-top:2px solid ${PRIMARY};` : ''}">${value}</td></tr>`;

  const taxTable = isTaxInvoice && ts.rows.length ? `
    <table style="margin-top:18px;">
      <thead><tr><th>GST rate</th><th style="text-align:right;">Taxable value</th>${ts.intra ? '<th style="text-align:right;">CGST</th><th style="text-align:right;">SGST</th>' : '<th style="text-align:right;">IGST</th>'}<th style="text-align:right;">Total tax</th></tr></thead>
      <tbody>${ts.rows.map((r) => `<tr>
        ${td(`${e(r.rate)}%`)}${td(rupee(r.taxableValue), 'text-align:right;')}
        ${ts.intra ? td(`${rupee(r.cgst)} <span style="color:#9ca3af;">(${e(r.rate / 2)}%)</span>`, 'text-align:right;') + td(`${rupee(r.sgst)} <span style="color:#9ca3af;">(${e(r.rate / 2)}%)</span>`, 'text-align:right;') : td(`${rupee(r.igst)} <span style="color:#9ca3af;">(${e(r.rate)}%)</span>`, 'text-align:right;')}
        ${td(rupee(r.tax), 'text-align:right;')}
      </tr>`).join('')}</tbody>
    </table>` : '';

  const creditNotes = (d.refunds || []).filter((r) => r.status === 'processed');
  const g = b.grievance;
  const grievanceLine = [g.name, g.designation, g.email, g.phone].filter(Boolean).map(e).join(' · ');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${e(docTitle === 'TAX INVOICE' ? 'Tax Invoice' : 'Bill of Supply')} ${e(d.invoiceNumber || '#' + d.shortId)} · ${e(b.name)}</title>
<style>
  *, *::before, *::after { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#f7efe9; color:#1f2937; margin:0; padding:24px; }
  .sheet { max-width:820px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,.06); }
  .head { background:#a01142; background:linear-gradient(135deg, ${PRIMARY}, #8b1a3a); color:#fff; padding:24px 32px; display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; }
  .head * { color:#fff; }
  .muted { color:#6b7280; font-size:13px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#9ca3af; padding:8px; border-bottom:1px solid #eee; }
  td { font-size:14px; }
  .btn { display:inline-block; background:${PRIMARY}; color:#fff; text-decoration:none; padding:10px 20px; border-radius:10px; font-weight:600; border:none; cursor:pointer; font-size:14px; }
  @media print { @page { size:A4; margin:12mm; } body { background:#fff !important; padding:0; } .sheet { box-shadow:none; border-radius:0; max-width:100%; } .no-print { display:none !important; } }
</style></head>
<body>
  <div class="sheet">
    <div class="head">
      <div style="display:flex;align-items:center;gap:14px;">
        <span style="background:#fff;border-radius:12px;padding:7px 11px;display:inline-flex;"><img src="${e(LOGO_URL())}" alt="${e(b.name)}" width="92" height="46" style="height:46px;width:auto;display:block;"/></span>
        <div>
          <div style="font-size:21px;font-weight:800;">${e(b.legalName)}</div>
          ${b.legalName !== b.name ? `<div style="font-size:13px;opacity:.9;">${e(b.name)}</div>` : ''}
          <div style="opacity:.85;font-size:12px;margin-top:4px;max-width:360px;">${e(b.address)}</div>
          <div style="opacity:.85;font-size:12px;">${[b.phoneDisplay, b.email].filter(Boolean).map(e).join(' · ')}</div>
          <div style="opacity:.85;font-size:12px;">${b.gstin ? `GSTIN: ${e(b.gstin)}` : ''}${b.gstin && b.fssaiLicense ? ' · ' : ''}${b.fssaiLicense ? `FSSAI Lic. No.: ${e(b.fssaiLicense)}` : ''}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px;letter-spacing:.08em;font-weight:700;">${e(docTitle)}</div>
        <div style="font-size:17px;font-weight:700;margin-top:4px;">${d.invoiceNumber ? e(d.invoiceNumber) : 'Not yet issued (unpaid)'}</div>
        <div style="font-size:12px;opacity:.85;margin-top:4px;">${d.invoiceDate ? `Date: ${e(fmtDate(d.invoiceDate, false))}` : ''}</div>
        <div style="font-size:12px;opacity:.85;">Order #${e(d.shortId)} · ${e(fmtDate(d.date))}</div>
      </div>
    </div>

    <div style="padding:22px 32px;">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:18px;">
        <div>
          <div class="muted" style="text-transform:uppercase;font-size:11px;letter-spacing:.05em;">Billed / shipped to</div>
          <div style="font-weight:600;margin-top:4px;">${e(d.customer.name)}</div>
          <div class="muted">${e(d.customer.address || '')}</div>
          <div class="muted">${e(d.customer.phone || '')}${d.customer.email ? ' · ' + e(d.customer.email) : ''}</div>
        </div>
        <div style="text-align:right;">
          <div class="muted" style="text-transform:uppercase;font-size:11px;letter-spacing:.05em;">Place of supply</div>
          <div style="font-weight:600;margin-top:4px;">${e(d.customer.state || '—')}</div>
          <div class="muted" style="margin-top:6px;">Payment: <span style="text-transform:capitalize;">${e(d.paymentStatus || 'pending')}</span> (Prepaid)</div>
          ${d.deliveryDate ? `<div class="muted">Delivery: ${e(fmtDate(d.deliveryDate, false))}</div>` : ''}
        </div>
      </div>

      <table>
        <thead><tr><th>#</th><th>Item</th><th>HSN</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Rate</th>${isTaxInvoice ? '<th style="text-align:center;">GST</th>' : ''}<th style="text-align:right;">Amount</th></tr></thead>
        <tbody>
          ${itemRows}
          ${totalRow('Subtotal', rupee(d.subtotal))}
          ${isTaxInvoice ? totalRow(d.gstIncluded ? 'GST included in prices' : 'GST', rupee(d.gst)) : ''}
          ${totalRow('Delivery', d.delivery > 0 ? rupee(d.delivery) : 'FREE')}
          ${d.platformFee > 0 ? totalRow('Platform fee', rupee(d.platformFee)) : ''}
          ${totalRow('Total', rupee(d.total), true)}
          ${d.refundedAmount > 0 ? totalRow('Refunded', `-${rupee(d.refundedAmount)}`) : ''}
        </tbody>
      </table>
      ${taxTable}
      ${declaration ? `<p class="muted" style="margin-top:16px;"><strong>Declaration:</strong> ${e(declaration)}</p>` : ''}
      ${creditNotes.length ? `<p class="muted" style="margin-top:10px;"><strong>Credit notes:</strong> ${creditNotes.map((r) => `${e(r.creditNoteNumber || 'pending')} (${rupee(r.amount)}${r.arn ? `, ARN ${e(r.arn)}` : ''})`).join('; ')}</p>` : ''}
      ${grievanceLine ? `<p class="muted" style="margin-top:10px;"><strong>Grievance officer:</strong> ${grievanceLine}</p>` : ''}
      <p class="muted" style="margin-top:18px;text-align:center;">Thank you for your order! · This is a computer-generated document and does not require a signature.</p>
      <div class="no-print" style="text-align:center;margin-top:8px;">
        <button class="btn" onclick="window.print()">Download / Print</button>
      </div>
    </div>
  </div>
</body></html>`;
};

module.exports = { getInvoiceData, renderInvoiceHtml, taxSummary };
