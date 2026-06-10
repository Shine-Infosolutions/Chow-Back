const pushService = require('../services/push');

// Public: the browser needs this VAPID public key to create a subscription.
exports.getPublicKey = (req, res) => {
  res.json({ success: true, publicKey: pushService.getPublicKey(), configured: pushService.isPushConfigured() });
};

// Save / refresh this device's subscription for the logged-in user.
exports.subscribe = async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, message: 'Subscription is required' });
    }
    const userAgent = req.headers['user-agent'] || '';
    await pushService.saveSubscription(req.user, subscription, userAgent);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Remove this device's subscription (on disable / logout).
exports.unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body;
    await pushService.removeSubscription(endpoint);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Send a test notification to the caller's own devices (confirms the flow works).
exports.sendTest = async (req, res) => {
  try {
    const result = await pushService.sendToUser(req.user._id, {
      title: '🔔 Notifications enabled',
      body: 'You will now get order updates here, even when the app is closed.',
      url: req.user.role === 'admin' ? '/admin/orders' : '/orders',
      tag: 'test'
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
