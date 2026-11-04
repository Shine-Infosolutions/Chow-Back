const User = require('../models/User');
const Order = require('../models/Order');
const { asyncHandler, httpError, toStr, escapeRegex, parsePagination, isValidId } = require('../utils/http');
const { assertValidAddress, normalizePhone, describePincode } = require('../utils/addressValidation');

// Admin: list / search customers (paginated). Never includes password.
exports.getUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 12, maxLimit: 100 });
  const search = toStr(req.query.search).slice(0, 100);

  const query = {};
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    query.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }

  const [users, total] = await Promise.all([
    User.find(query).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(query),
  ]);

  // Paid-order stats for this page's users in one aggregation.
  const stats = await Order.aggregate([
    { $match: { userId: { $in: users.map((u) => u._id) }, paymentStatus: 'paid' } },
    { $group: { _id: '$userId', orderCount: { $sum: 1 }, totalSpent: { $sum: { $subtract: ['$totalAmount', { $ifNull: ['$refundedAmount', 0] }] } } } }, // net of refunds
  ]);
  const statById = new Map(stats.map((s) => [String(s._id), s]));

  const rows = users.map((u) => {
    const def = (u.address || []).find((a) => a.isDefault) || (u.address || [])[0] || {};
    const customerPhone = [u.phone, def.phone].map(normalizePhone).find(Boolean) || null;
    let customerAltPhone = normalizePhone(def.altPhone);
    if (customerAltPhone === customerPhone) customerAltPhone = null;
    return {
      ...u,
      isGuest: u.isGuest === true,
      orderCount: statById.get(String(u._id))?.orderCount || 0,
      totalSpent: Math.round((statById.get(String(u._id))?.totalSpent || 0) * 100) / 100,
      customerPhone,
      customerAltPhone,
      customerFirstName: def.firstName || (u.name ? String(u.name).trim().split(/\s+/)[0] : null),
    };
  });

  res.json({
    success: true,
    users: rows,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
});

const loadUser = async (userId) => {
  if (!isValidId(toStr(userId))) throw httpError(400, 'Invalid user id');
  const user = await User.findById(userId);
  if (!user) throw httpError(404, 'User not found');
  return user;
};

const addressesOut = (user) => user.address.map((a) => ({ ...a.toObject(), _id: a._id }));

// Only the latest isDefault wins.
const applyDefault = (user, address) => {
  if (address.isDefault) user.address.forEach((a) => { if (String(a._id) !== String(address._id)) a.isDefault = false; });
};

exports.getUserAddresses = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.userId);
  res.json({ success: true, addresses: addressesOut(user) });
});

exports.addAddress = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.userId);
  if (user.address.length >= 20) throw httpError(400, 'You can save at most 20 addresses');
  const value = await assertValidAddress(req.body || {});
  if (!value.email && user.email) value.email = user.email;
  if (!user.address.length) value.isDefault = true;

  user.address.push(value);
  const newAddress = user.address[user.address.length - 1];
  applyDefault(user, newAddress);
  await user.save();

  res.status(201).json({
    success: true,
    address: newAddress,
    addressId: newAddress._id.toString(),
    addresses: addressesOut(user),
  });
});

exports.updateAddress = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.userId);
  const address = user.address.id(toStr(req.params.addressId));
  if (!address) throw httpError(404, 'Address not found');

  // Partial update: merge, then validate the whole address.
  const merged = { ...address.toObject(), ...(req.body || {}) };
  if (req.body?.isDefault === undefined) merged.isDefault = address.isDefault;
  const value = await assertValidAddress(merged);
  address.set(value);
  applyDefault(user, address);
  await user.save();

  res.json({ success: true, addresses: addressesOut(user) });
});

exports.deleteAddress = asyncHandler(async (req, res) => {
  const user = await loadUser(req.params.userId);
  const addressId = toStr(req.params.addressId);
  const address = user.address.id(addressId);
  if (!address) throw httpError(404, 'Address not found');

  const wasDefault = address.isDefault;
  user.address.pull({ _id: address._id });
  if (wasDefault && user.address.length) user.address[0].isDefault = true;
  await user.save();

  res.json({ success: true, addresses: addressesOut(user) });
});

// Public: GET /api/address/pincode/:pincode
exports.lookupPincode = asyncHandler(async (req, res) => {
  res.json(await describePincode(toStr(req.params.pincode)));
});
