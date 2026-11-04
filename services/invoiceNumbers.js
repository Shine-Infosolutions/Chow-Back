/**
 * Atomic per-financial-year document numbers.
 *   Invoice:     {prefix}/{FY}/{00001}      e.g. CSH/2026-27/00001
 *   Credit note: {prefix}/CN/{FY}/{00001}
 * FY runs April–March in IST. Counters live in the `counters` collection.
 */
const Counter = require('../models/Counter');
const Order = require('../models/Order');
const { getSettings } = require('./settings');
const { istDateString } = require('../utils/dates');

const fyOf = (date = new Date()) => {
  const [y, m] = istDateString(date).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

const nextSeq = async (key) => {
  const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return c.seq;
};

const prefixOf = async () => (await getSettings()).legal?.invoicePrefix || 'CSH';

// Assigns the invoice number once (no-op if the order already has one). Returns the number.
const assignInvoiceNumber = async (orderId) => {
  const order = await Order.findById(orderId).select('invoiceNumber paidAt confirmedAt paymentStatus');
  if (!order || order.paymentStatus !== 'paid') return null;
  if (order.invoiceNumber) return order.invoiceNumber;
  const date = order.paidAt || order.confirmedAt || new Date();
  const fy = fyOf(date);
  const seq = await nextSeq(`invoice:${fy}`);
  const number = `${await prefixOf()}/${fy}/${String(seq).padStart(5, '0')}`;
  const r = await Order.updateOne(
    { _id: orderId, $or: [{ invoiceNumber: null }, { invoiceNumber: { $exists: false } }] },
    { $set: { invoiceNumber: number, invoiceDate: new Date() } }
  );
  if (!r.modifiedCount) return (await Order.findById(orderId).select('invoiceNumber')).invoiceNumber;
  return number;
};

// Gives every processed refund without one a credit-note number.
const assignCreditNotes = async (orderId) => {
  const order = await Order.findById(orderId).select('refunds');
  if (!order) return;
  for (const r of order.refunds || []) {
    if (r.status !== 'processed' || r.creditNoteNumber) continue;
    const fy = fyOf(new Date());
    const seq = await nextSeq(`creditnote:${fy}`);
    const number = `${await prefixOf()}/CN/${fy}/${String(seq).padStart(5, '0')}`;
    await Order.updateOne(
      { _id: orderId, refunds: { $elemMatch: { _id: r._id, creditNoteNumber: { $in: [null, ''] } } } },
      { $set: { 'refunds.$.creditNoteNumber': number } }
    );
  }
};

module.exports = { fyOf, assignInvoiceNumber, assignCreditNotes };
