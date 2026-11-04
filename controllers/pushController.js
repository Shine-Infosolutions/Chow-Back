const pushService = require('../services/push');
const { asyncHandler, httpError, toStr } = require('../utils/http');

// Public: the browser needs this VAPID public key to create a subscription.
exports.getPublicKey = (req, res) => {
  res.json({ success: true, publicKey: pushService.getPublicKey(), configured: pushService.isPushConfigured() });
};

// Save / refresh this device's subscription for the logged-in user (guests included).
exports.subscribe = asyncHandler(async (req, res) => {
  const sub = req.body?.subscription;
  const endpoint = toStr(sub?.endpoint);
  if (!endpoint || !/^https:\/\//i.test(endpoint) || !toStr(sub?.keys?.p256dh) || !toStr(sub?.keys?.auth)) {
    throw httpError(400, 'A valid subscription is required');
  }
  const subscription = { endpoint, keys: { p256dh: toStr(sub.keys.p256dh), auth: toStr(sub.keys.auth) } };
  await pushService.saveSubscription(req.user, subscription, toStr(req.headers['user-agent']).slice(0, 300));
  res.json({ success: true });
});

// Remove this device's subscription (on disable / logout) — only the caller's own.
exports.unsubscribe = asyncHandler(async (req, res) => {
  await pushService.removeSubscription(toStr(req.body?.endpoint), req.user._id);
  res.json({ success: true });
});

// Send a test notification to the caller's own devices.
exports.sendTest = asyncHandler(async (req, res) => {
  const result = await pushService.sendToUser(req.user._id, {
    title: '🔔 Notifications enabled',
    body: 'You will now get order updates here, even when the app is closed.',
    url: req.user.role === 'admin' ? '/admin/orders' : '/orders',
    tag: 'test'
  });
  res.json({ success: true, ...result });
});
