const { e, heading, paragraph, orderPill, itemsTable, itemsText, orderButtons, ordersUrl, layout, textFooter, rupeeText } = require('./layout');
const { BRAND: SITE_BRAND } = require('../../config/site');

// d = getInvoiceData(order); { reason, refundAmount, refundMode }
module.exports = (d, { reason, refundAmount = 0, refundMode, invoiceUrl, brand: brandOpt } = {}) => {
  const BRAND = brandOpt || SITE_BRAND;
  const refundLine = refundAmount > 0
    ? (refundMode === 'razorpay'
      ? `A refund of <strong>${e(rupeeText(refundAmount))}</strong> has been initiated to your original payment method. It usually reaches your account in 5–7 working days.`
      : `A refund of <strong>${e(rupeeText(refundAmount))}</strong> is being processed by our team.`)
    : `If you've already paid and a refund applies, our team will contact you shortly.`;
  const refundText = refundAmount > 0
    ? `Refund: ${rupeeText(refundAmount)}${refundMode === 'razorpay' ? ' to your original payment method (5-7 working days).' : ' (processed by our team).'}`
    : `If a refund applies, our team will contact you shortly.`;
  const html = layout({
    brand: BRAND,
    title: `Order cancelled #${d.shortId}`,
    preheader: `Your order #${d.shortId} has been cancelled.`,
    bodyHtml: `
      ${heading('Order cancelled')}
      ${orderPill(d.shortId)}
      ${paragraph(`Hi ${e(d.customer.firstName || d.customer.name)},`)}
      ${paragraph(`Your order has been cancelled${reason ? ` — <em>${e(reason)}</em>` : ''}. We're sorry for the inconvenience.`)}
      ${paragraph(refundLine)}
      ${itemsTable(d)}
      ${orderButtons({ invoiceUrl })}
      ${paragraph('Questions? Call or WhatsApp us — we\'re happy to help.', { muted: true, size: 13, align: 'center' })}
    `,
  });
  const text = `Hi ${d.customer.firstName || d.customer.name},\n\nYour order #${d.shortId} has been cancelled${reason ? ` (${reason})` : ''}.\n${refundText}\n\n${itemsText(d)}\n\nView order: ${ordersUrl()}${textFooter(BRAND)}`;
  return { subject: `Order Cancelled #${d.shortId} · ${BRAND.name}`, html, text };
};
