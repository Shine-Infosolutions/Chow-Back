const { e, C, SANS, heading, paragraph, orderPill, orderButtons, ordersUrl, layout, textFooter, rupee, rupeeText } = require('./layout');
const { BRAND: SITE_BRAND } = require('../../config/site');

// d = getInvoiceData(order); { amount, mode: 'razorpay'|'manual', totalRefunded }
module.exports = (d, { amount, mode, totalRefunded, invoiceUrl, arn, brand: brandOpt } = {}) => {
  const BRAND = brandOpt || SITE_BRAND;
  const how = mode === 'razorpay'
    ? 'to your original payment method. Depending on your bank it usually appears in 5–7 working days.'
    : 'by our team directly (UPI / bank transfer / cash as agreed).';
  const html = layout({
    brand: BRAND,
    title: `Refund processed #${d.shortId}`,
    preheader: `Refund of ${rupeeText(amount)} for order #${d.shortId}.`,
    bodyHtml: `
      ${heading('Refund processed')}
      ${orderPill(d.shortId)}
      ${paragraph(`Hi ${e(d.customer.firstName || d.customer.name)},`)}
      ${paragraph(`We've refunded <strong>${e(rupeeText(amount))}</strong> ${e(how)}`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;">
        <tr><td style="background:${C.cream};border-radius:10px;padding:14px 16px;font-family:${SANS};font-size:14px;color:${C.text};line-height:1.8;">
          Refund amount: <strong style="color:${C.primary};">${e(rupee(amount))}</strong><br/>
          Refund method: ${e(mode === 'razorpay' ? 'Original payment method (Razorpay)' : 'Manual')}<br/>
          Order total: ${e(rupee(d.total))}${totalRefunded != null ? `<br/>Total refunded so far: ${e(rupee(totalRefunded))}` : ''}${arn ? `<br/>Bank reference (ARN): <strong>${e(arn)}</strong>` : ''}
        </td></tr>
      </table>
      ${orderButtons({ invoiceUrl })}
    `,
  });
  const text = `Hi ${d.customer.firstName || d.customer.name},\n\nRefund of ${rupeeText(amount)} for order #${d.shortId} has been processed ${mode === 'razorpay' ? 'to your original payment method (usually 5-7 working days).' : 'manually by our team.'}\nOrder total: ${rupeeText(d.total)}${totalRefunded != null ? `\nTotal refunded: ${rupeeText(totalRefunded)}` : ''}${arn ? `\nBank reference (ARN): ${arn}` : ''}\n\nView order: ${ordersUrl()}${textFooter(BRAND)}`;
  return { subject: `Refund of ${rupeeText(amount)} processed · Order #${d.shortId}`, html, text };
};
