// Shared invoice/order presentation helpers.
// Builds normalized invoice data from a (populated) order and renders both a
// standalone printable HTML invoice and the order-confirmation email body.

const SHOP = {
  name: 'Chowdhry Sweet House',
  address: 'Vijay Chowk, in front of Vijay Talkies, Golghar, Gorakhpur, UP 273001',
  phone: '+91 7525025100',
  email: process.env.EMAIL_FROM || process.env.SMTP_USER || 'orders@chowdhrysweethouse.in',
  site: 'chowdhrysweethouse.in',
};
const BRAND = '#d80a4e';

const rupee = (n) => `₹${Number(n || 0).toFixed(2)}`;

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(d || '');
  }
};

// Find the delivery address subdoc on the populated user.
const getDeliveryAddress = (order) => {
  const addresses = order?.userId?.address || [];
  return addresses.find((a) => String(a._id) === String(order.addressId)) || addresses[0] || {};
};

const getInvoiceData = (order) => {
  const addr = getDeliveryAddress(order);
  const items = (order.items || []).map((it) => {
    const name = it.itemId?.name || 'Item';
    const qty = it.quantity || 0;
    const price = it.price || 0;
    return { name, qty, price, total: price * qty };
  });
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const gst = +(subtotal * 0.05).toFixed(2);
  const delivery = order.shipping?.total || 0;
  const platformFee = order.platformFee || 0;
  const total = order.totalAmount != null ? order.totalAmount : subtotal + gst + delivery + platformFee;

  const customerName =
    `${addr.firstName || ''} ${addr.lastName || ''}`.trim() || order.userId?.name || 'Customer';
  const addressLine = [addr.street, addr.apartment, addr.city, addr.state, addr.postcode]
    .filter(Boolean)
    .join(', ');

  return {
    orderId: String(order._id),
    shortId: String(order._id).slice(-8).toUpperCase(),
    date: order.createdAt,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryDate: order.deliveryDate,
    customer: {
      name: customerName,
      email: addr.email || order.userId?.email || '',
      phone: order.contactPhone || addr.phone || order.userId?.phone || '',
      address: addressLine,
    },
    items,
    subtotal,
    gst,
    delivery,
    platformFee,
    total,
  };
};

const itemRows = (items) =>
  items
    .map(
      (i, idx) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f0e6d8;">${idx + 1}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f0e6d8;">${i.name}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f0e6d8;text-align:center;">${i.qty}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f0e6d8;text-align:right;">${rupee(i.price)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f0e6d8;text-align:right;font-weight:600;">${rupee(i.total)}</td>
      </tr>`,
    )
    .join('');

const totalsBlock = (d) => `
  <tr><td colspan="3"></td><td style="padding:6px 8px;text-align:right;color:#6b7280;">Subtotal</td><td style="padding:6px 8px;text-align:right;">${rupee(d.subtotal)}</td></tr>
  <tr><td colspan="3"></td><td style="padding:6px 8px;text-align:right;color:#6b7280;">GST (5%)</td><td style="padding:6px 8px;text-align:right;">${rupee(d.gst)}</td></tr>
  <tr><td colspan="3"></td><td style="padding:6px 8px;text-align:right;color:#6b7280;">Delivery</td><td style="padding:6px 8px;text-align:right;">${d.delivery > 0 ? rupee(d.delivery) : 'FREE'}</td></tr>
  ${d.platformFee > 0 ? `<tr><td colspan="3"></td><td style="padding:6px 8px;text-align:right;color:#6b7280;">Platform fee</td><td style="padding:6px 8px;text-align:right;">${rupee(d.platformFee)}</td></tr>` : ''}
  <tr><td colspan="3"></td><td style="padding:10px 8px;text-align:right;font-weight:700;border-top:2px solid ${BRAND};">Total</td><td style="padding:10px 8px;text-align:right;font-weight:700;color:${BRAND};border-top:2px solid ${BRAND};">${rupee(d.total)}</td></tr>
`;

// Full standalone, printable invoice page (also the shareable link target).
const renderInvoiceHtml = (order) => {
  const d = getInvoiceData(order);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Invoice #${d.shortId} · ${SHOP.name}</title>
<style>
  @media print { .no-print { display:none !important; } body { background:#fff; } }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#f7efe9; color:#1f2937; margin:0; padding:24px; }
  .sheet { max-width:760px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,.06); }
  .head { background:linear-gradient(135deg, ${BRAND}, #8b1a3a); color:#fff; padding:28px 32px; display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; }
  .muted { color:#6b7280; font-size:13px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#9ca3af; padding:8px; border-bottom:1px solid #eee; }
  .btn { display:inline-block; background:${BRAND}; color:#fff; text-decoration:none; padding:10px 20px; border-radius:10px; font-weight:600; border:none; cursor:pointer; font-size:14px; }
</style></head>
<body>
  <div class="sheet">
    <div class="head">
      <div>
        <div style="font-size:22px;font-weight:800;">${SHOP.name}</div>
        <div style="opacity:.85;font-size:13px;margin-top:4px;max-width:320px;">${SHOP.address}</div>
        <div style="opacity:.85;font-size:13px;">${SHOP.phone} · ${SHOP.site}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px;opacity:.85;">INVOICE</div>
        <div style="font-size:20px;font-weight:700;">#${d.shortId}</div>
        <div style="font-size:12px;opacity:.85;margin-top:4px;">${fmtDate(d.date)}</div>
      </div>
    </div>

    <div style="padding:24px 32px;">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:20px;">
        <div>
          <div class="muted" style="text-transform:uppercase;font-size:11px;letter-spacing:.05em;">Billed to</div>
          <div style="font-weight:600;margin-top:4px;">${d.customer.name}</div>
          <div class="muted">${d.customer.address || ''}</div>
          <div class="muted">${d.customer.phone || ''}${d.customer.email ? ' · ' + d.customer.email : ''}</div>
        </div>
        <div style="text-align:right;">
          <div class="muted" style="text-transform:uppercase;font-size:11px;letter-spacing:.05em;">Payment</div>
          <div style="font-weight:600;margin-top:4px;text-transform:capitalize;">${d.paymentStatus || 'pending'}</div>
          ${d.deliveryDate ? `<div class="muted">Delivery: ${new Date(d.deliveryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>` : ''}
        </div>
      </div>

      <table>
        <thead><tr><th>#</th><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Amount</th></tr></thead>
        <tbody>${itemRows(d.items)}${totalsBlock(d)}</tbody>
      </table>

      <p class="muted" style="margin-top:24px;text-align:center;">Thank you for your order! · Prepaid · This is a computer-generated invoice.</p>
      <div class="no-print" style="text-align:center;margin-top:8px;">
        <button class="btn" onclick="window.print()">Download / Print Invoice</button>
      </div>
    </div>
  </div>
</body></html>`;
};

// Order-confirmation email body.
const renderOrderEmailHtml = (order, { invoiceUrl, trackUrl } = {}) => {
  const d = getInvoiceData(order);
  return `<!doctype html><html><body style="margin:0;background:#f7efe9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.06);">
      <div style="background:linear-gradient(135deg,${BRAND},#8b1a3a);color:#fff;padding:28px;text-align:center;">
        <div style="font-size:20px;font-weight:800;">${SHOP.name}</div>
        <div style="font-size:15px;margin-top:8px;">✅ Order Confirmed!</div>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 4px;">Hi ${d.customer.name},</p>
        <p style="margin:0 0 16px;color:#4b5563;">Thank you for your order. We're preparing your sweets with love. 🍬</p>
        <div style="background:#fdf6ee;border:1px solid #f0e6d8;border-radius:12px;padding:16px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;">Order ID</span><b>#${d.shortId}</b></div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;border-top:1px dashed #e7d8c4;padding-top:8px;"><span style="color:#6b7280;">Total Paid</span><b style="color:${BRAND};">${rupee(d.total)}</b></div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          ${d.items
            .map(
              (i) =>
                `<tr><td style="padding:6px 0;color:#374151;">${i.name} × ${i.qty}</td><td style="padding:6px 0;text-align:right;">${rupee(i.total)}</td></tr>`,
            )
            .join('')}
        </table>
        <div style="text-align:center;margin-top:24px;">
          ${invoiceUrl ? `<a href="${invoiceUrl}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:600;">View Invoice</a>` : ''}
          ${trackUrl ? `<a href="${trackUrl}" style="display:inline-block;margin-left:8px;color:${BRAND};text-decoration:none;padding:11px 12px;font-weight:600;">Track Order</a>` : ''}
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px;">${SHOP.name} · ${SHOP.phone}<br/>${SHOP.address}</p>
      </div>
    </div>
  </div></body></html>`;
};

module.exports = { getInvoiceData, renderInvoiceHtml, renderOrderEmailHtml, SHOP };
