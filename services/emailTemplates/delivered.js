const { e, heading, paragraph, orderPill, orderButtons, ordersUrl, layout, textFooter } = require('./layout');
const { BRAND: SITE_BRAND } = require('../../config/site');

module.exports = (d, { invoiceUrl, brand: brandOpt } = {}) => {
  const BRAND = brandOpt || SITE_BRAND;
  const html = layout({
    brand: BRAND,
    title: `Delivered #${d.shortId}`,
    preheader: `Your order has been delivered. Enjoy!`,
    bodyHtml: `
      ${heading('Delivered — enjoy!')}
      ${orderPill(d.shortId)}
      ${paragraph(`Hi ${e(d.customer.firstName || d.customer.name)},`)}
      ${paragraph(`Your order has been delivered. We hope every bite brings a smile. If anything isn't right, reply on WhatsApp or call us and we'll make it right.`)}
      ${orderButtons({ invoiceUrl })}
    `,
  });
  const text = `Hi ${d.customer.firstName || d.customer.name},\n\nYour order #${d.shortId} has been delivered. Enjoy!\nIf anything isn't right, call or WhatsApp us.\n\nView order: ${ordersUrl()}${invoiceUrl ? `\nInvoice: ${invoiceUrl}` : ''}${textFooter(BRAND)}`;
  return { subject: `Delivered · Order #${d.shortId} · ${BRAND.name}`, html, text };
};
