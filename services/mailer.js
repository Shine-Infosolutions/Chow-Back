// Email service. nodemailer over SMTP (e.g. Gmail + App Password). Env:
//   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465), SMTP_USER, SMTP_PASS,
//   EMAIL_FROM ("Name <email>", defaults to "Chowdhry Sweet House <SMTP_USER>"),
//   API_PUBLIC_URL (backend URL for signed invoice links), FRONTEND_URL (storefront links/logo).
//
// Order emails never throw: they return a status object so the payment/admin flows stay safe.
// Templates: services/emailTemplates/* (all user data HTML-escaped, each with a text part).

const nodemailer = require('nodemailer');
const Order = require('../models/Order');
const templates = require('./emailTemplates');
const { renderInvoiceHtml, getInvoiceData } = require('../utils/invoice');
const { BRAND } = require('../config/site');

let transporter = null;

const isEmailConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
  if (!isEmailConfigured()) return null;
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT) || 465;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
  return transporter;
};

const brandNow = async () => {
  const { getSettings, brandFromSettings } = require('./settings');
  return brandFromSettings(await getSettings());
};

const fromAddress = (name = BRAND.name) => process.env.EMAIL_FROM || `${name.replace(/[<>"]/g, '')} <${process.env.SMTP_USER}>`;

const sendMail = async ({ to, subject, html, text, fromName }) => {
  const tx = getTransporter();
  if (!tx) {
    console.warn('[mailer] SMTP not configured — skipping email');
    return { success: false, skipped: true };
  }
  if (!to) return { success: false, error: 'No recipient email' };
  try {
    await tx.sendMail({ from: fromAddress(fromName), to, subject, html, text });
    return { success: true };
  } catch (err) {
    console.error('[mailer] send failed:', err.message);
    return { success: false, error: 'Email delivery failed' };
  }
};

// Signed invoice link (?t=invoiceToken) — the invoice route rejects requests without it.
const invoiceUrlFor = (orderId, baseUrl) => {
  const { invoiceTokenFor } = require('../utils');
  const base = (baseUrl || process.env.API_PUBLIC_URL || '').replace(/\/$/, '');
  return base ? `${base}/api/orders/${orderId}/invoice?t=${invoiceTokenFor(orderId)}` : null;
};

/* ------------------------------- Order emails ---------------------------- */

const ORDER_TEMPLATES = {
  confirmed: templates.orderConfirmed,
  cancelled: templates.orderCancelled,
  refund: templates.refundProcessed,
  out_for_delivery: templates.outForDelivery,
  delivered: templates.delivered,
};

/**
 * Send an order email. kind: confirmed | cancelled | refund | out_for_delivery | delivered.
 * Only for PAID orders. Recipient: shippingAddress.email, else the account email; guests without
 * any email are skipped silently ({ skipped:true }).
 */
const sendOrderEmail = async (orderId, kind, extra = {}) => {
  try {
    const render = ORDER_TEMPLATES[kind];
    if (!render) return { success: false, error: 'Unknown email kind' };
    const order = await Order.findById(orderId)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price');
    if (!order) return { success: false, error: 'Order not found' };
    if (order.paymentStatus !== 'paid') return { success: false, error: 'Order is not paid' };

    const d = getInvoiceData(order);
    const to = order.shippingAddress?.email || order.userId?.email || d.customer.email;
    if (!to) return { success: false, skipped: true }; // e.g. guest without email — silent

    const invoiceUrl = invoiceUrlFor(order._id, extra.baseUrl);
    const brand = await brandNow();
    const t = render(d, { ...extra, invoiceUrl, brand });
    return await sendMail({ to, ...t, fromName: brand.name });
  } catch (err) {
    console.error(`[mailer] ${kind} email failed:`, err.message);
    return { success: false, error: 'Email could not be prepared' };
  }
};

const sendOrderConfirmationEmail = (orderId, opts = {}) => sendOrderEmail(orderId, 'confirmed', opts);

module.exports = {
  brandNow,
  isEmailConfigured,
  sendMail,
  sendOrderEmail,
  sendOrderConfirmationEmail,
  invoiceUrlFor,
  renderInvoiceHtml,
};
