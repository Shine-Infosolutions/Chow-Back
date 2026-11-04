const { e, heading, paragraph, orderPill, addressBlock, addressText, orderButtons, ordersUrl, layout, textFooter } = require('./layout');
const { BRAND: SITE_BRAND } = require('../../config/site');

module.exports = (d, { invoiceUrl, brand: brandOpt } = {}) => {
  const BRAND = brandOpt || SITE_BRAND;
  const html = layout({
    brand: BRAND,
    title: `Out for delivery #${d.shortId}`,
    preheader: `Your sweets are on the way!`,
    bodyHtml: `
      ${heading('Your order is on the way')}
      ${orderPill(d.shortId)}
      ${paragraph(`Hi ${e(d.customer.firstName || d.customer.name)},`)}
      ${paragraph(`Good news — your order is out for delivery today. Please keep your phone reachable so our delivery partner can contact you.`)}
      ${addressBlock(d)}
      ${orderButtons({ invoiceUrl })}
    `,
  });
  const text = `Hi ${d.customer.firstName || d.customer.name},\n\nYour order #${d.shortId} is out for delivery. Please keep your phone reachable.\n${addressText(d)}\n\nView order: ${ordersUrl()}${textFooter(BRAND)}`;
  return { subject: `Out for delivery · Order #${d.shortId} · ${BRAND.name}`, html, text };
};
