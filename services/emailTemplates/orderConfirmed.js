const { e, heading, paragraph, orderPill, itemsTable, itemsText, addressBlock, addressText, orderButtons, ordersUrl, layout, textFooter, rupeeText } = require('./layout');
const { BRAND: SITE_BRAND } = require('../../config/site');

// Payment received + order confirmed. d = getInvoiceData(order)
module.exports = (d, { invoiceUrl, brand: brandOpt } = {}) => {
  const BRAND = brandOpt || SITE_BRAND;
  const html = layout({
    brand: BRAND,
    title: `Order confirmed #${d.shortId}`,
    preheader: `Payment of ${rupeeText(d.total)} received — we're preparing your sweets.`,
    bodyHtml: `
      ${heading('Order confirmed!')}
      ${orderPill(d.shortId)}
      ${paragraph(`Hi ${e(d.customer.firstName || d.customer.name)},`)}
      ${paragraph(`We've received your payment of <strong>${e(rupeeText(d.total))}</strong> and your order is confirmed. Our kitchen is preparing your sweets with love — we'll let you know when they're on the way.`)}
      ${itemsTable(d)}
      ${addressBlock(d)}
      ${orderButtons({ invoiceUrl })}
    `,
  });
  const text = `Hi ${d.customer.firstName || d.customer.name},\n\nYour order #${d.shortId} is confirmed — payment of ${rupeeText(d.total)} received.\n\n${itemsText(d)}\n\n${addressText(d)}\n\nView order: ${ordersUrl()}${invoiceUrl ? `\nInvoice: ${invoiceUrl}` : ''}${textFooter(BRAND)}`;
  return { subject: `Order Confirmed #${d.shortId} · ${BRAND.name}`, html, text };
};
