/**
 * Web Push notification service.
 *
 * Sends notifications to a customer's devices or to all admin devices using the
 * Web Push protocol (VAPID). Every send is best-effort: failures are logged, never
 * thrown, and subscriptions the push service reports as gone (404/410) are pruned.
 */
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@chowdhrysweethouse.in';

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  } catch (e) {
    console.error('Web Push VAPID setup failed:', e.message);
  }
} else {
  console.warn('Web Push not configured (VAPID keys missing) — notifications are disabled.');
}

const isPushConfigured = () => configured;

const getPublicKey = () => (configured ? PUBLIC_KEY : null);

/**
 * Save / refresh a device subscription. Keyed by endpoint so the same device that
 * re-subscribes (or a different user logging in on it) updates the existing record.
 */
const saveSubscription = async (user, subscription, userAgent = '') => {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error('Invalid subscription');
  }
  const doc = await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      userId: user._id || user.id,
      role: user.role === 'admin' ? 'admin' : 'user',
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      userAgent
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
};

const removeSubscription = async (endpoint) => {
  if (!endpoint) return;
  await PushSubscription.deleteOne({ endpoint });
};

/**
 * Push a payload to an explicit list of subscription docs. Prunes dead endpoints.
 */
const sendToSubscriptions = async (subs, payload) => {
  if (!configured || !subs.length) return { sent: 0, removed: 0 };
  const body = JSON.stringify(payload);
  let sent = 0;
  const dead = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body
        );
        sent += 1;
      } catch (err) {
        // 404/410 → the browser unsubscribed or the endpoint expired.
        if (err.statusCode === 404 || err.statusCode === 410) {
          dead.push(sub.endpoint);
        } else {
          console.error('Push send error:', err.statusCode || '', err.body || err.message);
        }
      }
    })
  );

  if (dead.length) {
    await PushSubscription.deleteMany({ endpoint: { $in: dead } });
  }
  return { sent, removed: dead.length };
};

const sendToUser = async (userId, payload) => {
  if (!configured || !userId) return { sent: 0, removed: 0 };
  try {
    const subs = await PushSubscription.find({ userId });
    return await sendToSubscriptions(subs, payload);
  } catch (e) {
    console.error('sendToUser error:', e.message);
    return { sent: 0, removed: 0 };
  }
};

const sendToAdmins = async (payload) => {
  if (!configured) return { sent: 0, removed: 0 };
  try {
    const subs = await PushSubscription.find({ role: 'admin' });
    return await sendToSubscriptions(subs, payload);
  } catch (e) {
    console.error('sendToAdmins error:', e.message);
    return { sent: 0, removed: 0 };
  }
};

/* ----------------------------- Domain helpers ----------------------------- */

const shortId = (id) => String(id || '').slice(-6).toUpperCase();
const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

// New order placed → alert the shop (all admin devices).
const notifyNewOrder = (order) => {
  if (!order) return Promise.resolve();
  const customer = order.userId?.name ? ` from ${order.userId.name}` : '';
  return sendToAdmins({
    title: '🛎️ New order received',
    body: `Order #${shortId(order._id)}${customer} · ${rupees(order.totalAmount)}`,
    tag: `order-${order._id}`,
    url: '/admin/orders',
    type: 'new-order'
  });
};

// Friendly customer-facing copy per status change.
const CUSTOMER_MESSAGES = {
  confirmed: { title: '✅ Order confirmed', body: 'Your order is confirmed and being prepared.' },
  shipped: { title: '🚚 Order on the way', body: 'Your order is out for delivery.' },
  out_for_delivery: { title: '🚚 Out for delivery', body: 'Your order is out for delivery today.' },
  delivered: { title: '🎉 Order delivered', body: 'Your order has been delivered. Enjoy your sweets!' },
  cancelled: { title: '⚠️ Order cancelled', body: 'Your order has been cancelled.' },
  delayed: { title: '⏳ Order delayed', body: 'Your order delivery has been rescheduled.' },
  delivery_date: { title: '📅 Delivery scheduled', body: 'A delivery date has been set for your order.' }
};

// Order changed → notify that order's customer. `extra` can override body text.
const notifyOrderUpdate = (order, statusKey, extra = {}) => {
  if (!order?.userId) return Promise.resolve();
  const base = CUSTOMER_MESSAGES[statusKey] || { title: 'Order update', body: 'Your order status has changed.' };
  const userId = order.userId._id || order.userId;
  return sendToUser(userId, {
    title: extra.title || base.title,
    body: extra.body || `${base.body} (#${shortId(order._id)})`,
    tag: `order-${order._id}`,
    url: '/orders',
    type: 'order-update'
  });
};

module.exports = {
  isPushConfigured,
  getPublicKey,
  saveSubscription,
  removeSubscription,
  sendToUser,
  sendToAdmins,
  notifyNewOrder,
  notifyOrderUpdate
};
