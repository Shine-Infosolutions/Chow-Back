// Email service. Uses nodemailer over SMTP (any free provider — e.g. Gmail
// with an App Password). Configure via env:
//   SMTP_HOST   (default smtp.gmail.com)
//   SMTP_PORT   (default 465)
//   SMTP_USER   (your email)
//   SMTP_PASS   (app password)
//   EMAIL_FROM  (optional "Name <email>" — defaults to SMTP_USER)
//   API_PUBLIC_URL  (backend public URL, used to build invoice links)
//   FRONTEND_URL    (storefront URL, used for the Track Order link)
//
// Safe to call even when unconfigured: it no-ops and returns {skipped:true}.

const nodemailer = require('nodemailer');
const Order = require('../models/Order');
const { renderInvoiceHtml, renderOrderEmailHtml } = require('../utils/invoice');

let transporter = null;

const isEmailConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
  if (!isEmailConfigured()) return null;
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT) || 465;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465, // true for 465, false for 587
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
};

const fromAddress = () =>
  process.env.EMAIL_FROM || `Chowdhry Sweet House <${process.env.SMTP_USER}>`;

const sendMail = async ({ to, subject, html }) => {
  const tx = getTransporter();
  if (!tx) {
    console.warn('[mailer] SMTP not configured — skipping email to', to);
    return { success: false, skipped: true };
  }
  if (!to) return { success: false, error: 'No recipient email' };
  try {
    await tx.sendMail({ from: fromAddress(), to, subject, html });
    return { success: true };
  } catch (err) {
    console.error('[mailer] send failed:', err.message);
    return { success: false, error: err.message };
  }
};

const invoiceUrlFor = (orderId, baseUrl) => {
  const base = (baseUrl || process.env.API_PUBLIC_URL || '').replace(/\/$/, '');
  return base ? `${base}/api/orders/${orderId}/invoice` : null;
};

// Fetches the populated order, builds the confirmation email, and sends it.
// Never throws — returns a status object so callers (payment flow) stay safe.
const sendOrderConfirmationEmail = async (orderId, { baseUrl } = {}) => {
  try {
    const order = await Order.findById(orderId)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price');
    if (!order) return { success: false, error: 'Order not found' };

    const { getInvoiceData } = require('../utils/invoice');
    const to = getInvoiceData(order).customer.email;
    if (!to) return { success: false, error: 'No customer email on order' };

    const invoiceUrl = invoiceUrlFor(order._id, baseUrl);
    const frontend = (process.env.FRONTEND_URL || 'https://chowdhrysweethouse.in').replace(/\/$/, '');
    const html = renderOrderEmailHtml(order, { invoiceUrl, trackUrl: `${frontend}/orders` });

    return await sendMail({
      to,
      subject: `Order Confirmed #${String(order._id).slice(-8).toUpperCase()} · Chowdhry Sweet House`,
      html,
    });
  } catch (err) {
    console.error('[mailer] order confirmation failed:', err.message);
    return { success: false, error: err.message };
  }
};

module.exports = { isEmailConfigured, sendMail, sendOrderConfirmationEmail, invoiceUrlFor, renderInvoiceHtml };
