/**
 * Shared, email-client-safe layout for every transactional email.
 * Table-based 600px card, inline styles only (one small mobile media query), bulletproof buttons,
 * hidden preheader, `color-scheme: light`. All dynamic values must go through `e()`.
 */
const { escapeHtml: e } = require('../../utils/http');
const { frontendUrl, BRAND } = require('../../config/site');

const C = BRAND.colors;
const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = 'Arial, Helvetica, sans-serif';

const rupee = (n) => `₹${Number(n || 0).toFixed(2)}`;
const rupeeText = (n) => `Rs. ${Number(n || 0).toFixed(2)}`;

const logoUrl = () => process.env.LOGO_URL || `${frontendUrl()}/logo.png`;
const ordersUrl = () => `${frontendUrl()}/orders`;

/* ------------------------------- Components ------------------------------- */

// Bulletproof button: the colour lives on the <td>, so it renders even when CSS on <a> is stripped.
const button = (href, label, { variant = 'primary' } = {}) => {
  if (!href) return '';
  const primary = variant === 'primary';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:6px;">
  <tr><td align="center" bgcolor="${primary ? C.primary : '#ffffff'}" style="border-radius:8px;background:${primary ? C.primary : '#ffffff'};${primary ? '' : `border:2px solid ${C.primary};`}">
    <a href="${e(href)}" target="_blank" style="display:inline-block;padding:${primary ? '13px 26px' : '11px 24px'};font-family:${SANS};font-size:15px;font-weight:bold;line-height:18px;color:${primary ? '#ffffff' : C.primary};text-decoration:none;border-radius:8px;">${e(label)}</a>
  </td></tr></table>`;
};

const heading = (text) =>
  `<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:26px;line-height:32px;font-weight:700;color:${C.primary};text-align:center;">${e(text)}</h1>`;

const paragraph = (html, { align = 'left', muted = false, size = 15 } = {}) =>
  `<p style="margin:0 0 14px;font-family:${SANS};font-size:${size}px;line-height:1.6;color:${muted ? C.muted : C.text};text-align:${align};">${html}</p>`;

// Short order id in a gold-bordered pill.
const orderPill = (shortId) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 18px;">
  <tr><td style="border:2px solid ${C.gold};border-radius:999px;padding:6px 16px;font-family:${SANS};font-size:13px;font-weight:bold;letter-spacing:1px;color:${C.deep};background:${C.cream};">ORDER #${e(shortId)}</td></tr></table>`;

const itemsTable = (d) => {
  const rows = d.items.map((i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0e6d8;font-family:${SANS};font-size:14px;color:${C.text};">${e(i.name)}</td>
      <td align="center" style="padding:10px 6px;border-bottom:1px solid #f0e6d8;font-family:${SANS};font-size:14px;color:${C.muted};white-space:nowrap;">× ${e(i.qty)}</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #f0e6d8;font-family:${SANS};font-size:14px;color:${C.text};white-space:nowrap;">${e(rupee(i.total))}</td>
    </tr>`).join('');
  const line = (label, value, { bold = false } = {}) => `
    <tr>
      <td colspan="2" align="right" style="padding:${bold ? '10px' : '5px'} 8px 0 0;font-family:${SANS};font-size:${bold ? 16 : 14}px;color:${bold ? C.text : C.muted};${bold ? 'font-weight:bold;' : ''}">${e(label)}</td>
      <td align="right" style="padding:${bold ? '10px' : '5px'} 0 0;font-family:${SANS};font-size:${bold ? 16 : 14}px;white-space:nowrap;${bold ? `font-weight:bold;color:${C.primary};` : `color:${C.text};`}">${e(value)}</td>
    </tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;">
    <tr>
      <th align="left" style="padding:0 0 6px;font-family:${SANS};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};border-bottom:2px solid ${C.cream};">Item</th>
      <th align="center" style="padding:0 6px 6px;font-family:${SANS};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};border-bottom:2px solid ${C.cream};">Qty</th>
      <th align="right" style="padding:0 0 6px;font-family:${SANS};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};border-bottom:2px solid ${C.cream};">Price</th>
    </tr>
    ${rows}
    ${line('Subtotal', rupee(d.subtotal))}
    ${d.gstLabel && d.gst > 0 ? line(d.gstLabel, rupee(d.gst)) : ''}
    ${line('Delivery', d.delivery > 0 ? rupee(d.delivery) : 'FREE')}
    ${d.platformFee > 0 ? line('Platform fee', rupee(d.platformFee)) : ''}
    ${line('Total', rupee(d.total), { bold: true })}
  </table>`;
};

const itemsText = (d) =>
  [
    ...d.items.map((i) => `- ${i.name} x ${i.qty}: ${rupeeText(i.total)}`),
    `Subtotal: ${rupeeText(d.subtotal)}`,
    ...(d.gstLabel && d.gst > 0 ? [`${d.gstLabel}: ${rupeeText(d.gst)}`] : []),
    `Delivery: ${d.delivery > 0 ? rupeeText(d.delivery) : 'FREE'}`,
    ...(d.platformFee > 0 ? [`Platform fee: ${rupeeText(d.platformFee)}`] : []),
    `TOTAL: ${rupeeText(d.total)}`,
  ].join('\n');

const addressBlock = (d) => {
  if (!d.customer.address) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
  <tr><td style="background:${C.cream};border-radius:10px;padding:14px 16px;">
    <div style="font-family:${SANS};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};margin-bottom:6px;">Delivering to</div>
    <div style="font-family:${SANS};font-size:14px;line-height:1.5;color:${C.text};"><strong>${e(d.customer.name)}</strong><br/>${e(d.customer.address)}${d.customer.phone ? `<br/>${e(d.customer.phone)}` : ''}</div>
  </td></tr></table>`;
};

const addressText = (d) => (d.customer.address ? `Delivering to: ${d.customer.name}, ${d.customer.address}${d.customer.phone ? ` (${d.customer.phone})` : ''}` : '');

const orderButtons = ({ invoiceUrl } = {}) =>
  `<div style="text-align:center;margin:8px 0 6px;">${button(ordersUrl(), 'View order')}${invoiceUrl ? button(invoiceUrl, 'Download invoice', { variant: 'secondary' }) : ''}</div>`;

/* --------------------------------- Layout --------------------------------- */

// `brand` comes from Settings (services/settings.brandFromSettings); config/site BRAND is the fallback.
const footer = (B = BRAND) => {
  const link = (href, label) => `<a href="${e(href)}" target="_blank" style="color:${C.primary};text-decoration:none;">${e(label)}</a>`;
  const socials = [
    B.whatsapp && link(B.whatsapp, 'WhatsApp'),
    B.instagram && link(B.instagram, 'Instagram'),
    B.facebook && link(B.facebook, 'Facebook'),
    B.youtube && link(B.youtube, 'YouTube'),
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const legal = [B.legalName && B.legalName !== B.name ? B.legalName : '', B.gstin ? `GSTIN ${B.gstin}` : '', B.fssaiLicense ? `FSSAI Lic. ${B.fssaiLicense}` : '']
    .filter(Boolean).map(e).join(' · ');
  return `<tr><td align="center" style="padding:22px 28px 30px;font-family:${SANS};font-size:13px;line-height:1.7;color:${C.muted};">
    <div style="font-family:${SERIF};font-size:16px;color:${C.deep};margin-bottom:4px;">${e(B.name)}</div>
    <div style="font-style:italic;margin-bottom:8px;">${e(B.tagline)}</div>
    <div>${link(`tel:${B.phoneTel}`, B.phoneDisplay)}${B.email ? ` &nbsp;·&nbsp; ${link(`mailto:${B.email}`, B.email)}` : ''}</div>
    ${socials ? `<div>${socials}</div>` : ''}
    <div>${e(B.address || B.city)}</div>
    <div style="font-size:11px;color:#9a9a9a;margin-top:10px;">${legal ? `${legal}<br/>` : ''}You received this email because of an order at ${e(B.name)}. This is an automated message — please don't reply directly.</div>
  </td></tr>`;
};

/**
 * @param {object} o { title, preheader, bodyHtml }
 */
const layout = ({ title, preheader = '', bodyHtml, brand = BRAND }) => `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${e(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap" rel="stylesheet"/>
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  @media only screen and (max-width:620px) {
    .card { width:100% !important; }
    .pad { padding-left:18px !important; padding-right:18px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.creamAlt};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.creamAlt};">${e(preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.creamAlt}" style="background:${C.creamAlt};">
  <tr><td align="center" style="padding:24px 10px;">
    <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-top:6px solid ${C.primary};border-radius:14px;">
      <tr><td align="center" class="pad" style="padding:26px 28px 6px;">
        <img src="${e(logoUrl())}" alt="${e(brand.name)}" width="120" height="60" style="display:block;width:120px;height:60px;border:0;outline:none;text-decoration:none;object-fit:contain;color:${C.primary};font-family:${SERIF};font-size:18px;"/>
      </td></tr>
      <tr><td class="pad" style="padding:16px 32px 8px;">
        ${bodyHtml}
      </td></tr>
      ${footer(brand)}
    </table>
  </td></tr>
</table>
</body>
</html>`;

const textFooter = (B = BRAND) =>
  `\n--\n${B.name} — ${B.tagline}\nCall: ${B.phoneDisplay}${B.email ? ` | Email: ${B.email}` : ''}\nWhatsApp: ${B.whatsapp}${B.instagram ? `\nInstagram: ${B.instagram}` : ''}\n${B.address || B.city}`;

module.exports = {
  e, C, SERIF, SANS, rupee, rupeeText, ordersUrl,
  button, heading, paragraph, orderPill, itemsTable, itemsText, addressBlock, addressText, orderButtons,
  layout, textFooter,
};
