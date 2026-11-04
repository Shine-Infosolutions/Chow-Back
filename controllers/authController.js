const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { asyncHandler, httpError, toStr, escapeRegex } = require('../utils/http');
const { normalizePhone, garbageCheck } = require('../utils/addressValidation');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

// Guests get a 90-day token carrying guest:true; full accounts 7 days.
const generateToken = (user) =>
  jwt.sign(
    { id: String(user._id), role: user.role, tv: user.tokenVersion || 0, ...(user.isGuest ? { guest: true } : {}) },
    process.env.JWT_SECRET,
    { expiresIn: user.isGuest ? '90d' : '7d' }
  );

const sanitizeUser = (user) => {
  const { password, tokenVersion, ...userData } = user.toObject ? user.toObject() : user;
  return { ...userData, _id: userData._id, isGuest: userData.isGuest === true };
};

const normEmail = (v) => toStr(v).toLowerCase();
// Case-insensitive exact match so legacy mixed-case emails still match.
const emailFilter = (email) => ({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });

const cleanName = (v) => toStr(v).replace(/\s+/g, ' ').slice(0, 60);
const validName = (name) => name.length >= 2 && /^[\p{L} .'-]+$/u.test(name) && !garbageCheck(name);

const requireJwtSecret = () => {
  if (!process.env.JWT_SECRET) throw httpError(500, 'Server auth is not configured');
};

const validateCredentials = ({ name, email, password }) => {
  if (!validName(name)) throw httpError(400, 'Please enter your real name');
  if (!EMAIL_RE.test(email) || email.length > 254) throw httpError(400, 'Enter a valid email address');
  if (password.length < MIN_PASSWORD) throw httpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  if (password.length > 128) throw httpError(400, 'Password is too long');
};

/* ------------------------------ Registration ------------------------------ */
exports.userRegister = asyncHandler(async (req, res) => {
  requireJwtSecret();
  const name = cleanName(req.body?.name);
  const email = normEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const phone = normalizePhone(toStr(req.body?.phone));

  if (!name || !email || !password || !toStr(req.body?.phone)) throw httpError(400, 'name, email, phone and password are required');
  validateCredentials({ name, email, password });
  if (!phone) throw httpError(400, 'Enter a valid 10-digit Indian mobile number');

  if (await User.exists(emailFilter(email))) throw httpError(409, 'An account with this email already exists');

  const user = await new User({ name, email, password, phone, role: 'user', isGuest: false }).save();
  res.status(201).json({ success: true, user: sanitizeUser(user), token: generateToken(user) });
});

/* ------------------------- Mobile-only guest checkout ------------------------ */
// ALWAYS creates a NEW guest user. Never looks up / returns / merges an existing account by
// phone: without OTP that would be an account takeover.
exports.guestLogin = asyncHandler(async (req, res) => {
  requireJwtSecret();
  const phone = normalizePhone(toStr(req.body?.phone));
  if (!phone) throw httpError(400, 'Enter a valid 10-digit Indian mobile number');
  let name = cleanName(req.body?.name);
  if (name && !validName(name)) throw httpError(400, 'Please enter your real name');
  if (!name) name = 'Guest';

  // No email/password fields at all (omitted, not null) so the sparse email index ignores guests.
  const user = await new User({ name, phone, isGuest: true, role: 'user' }).save();
  res.status(201).json({ success: true, user: sanitizeUser(user), token: generateToken(user) });
});

// Convert the current guest into a full account ("save your details").
exports.claimAccount = asyncHandler(async (req, res) => {
  requireJwtSecret();
  if (req.user.isGuest !== true) throw httpError(409, 'This account is already registered');

  const name = cleanName(req.body?.name);
  const email = normEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!name || !email || !password) throw httpError(400, 'name, email and password are required');
  validateCredentials({ name, email, password });

  if (await User.exists({ ...emailFilter(email), _id: { $ne: req.user._id } })) {
    throw httpError(409, 'An account with this email already exists. Please log in with it instead.');
  }

  const user = await User.findById(req.user._id);
  user.name = name;
  user.email = email;
  user.password = password;
  user.isGuest = false;
  await user.save();
  res.json({ success: true, user: sanitizeUser(user), token: generateToken(user) });
});

/* ---------------------------------- Login --------------------------------- */
const login = (adminOnly) => asyncHandler(async (req, res) => {
  requireJwtSecret();
  const email = normEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) throw httpError(400, 'email and password are required');

  // Guests have no email/password, so they can never match here.
  const filter = { ...emailFilter(email), status: 'active', isGuest: { $ne: true } };
  if (adminOnly) filter.role = 'admin';
  const user = await User.findOne(filter);
  if (!user || !(await user.comparePassword(password))) {
    throw httpError(401, adminOnly ? 'Invalid admin credentials' : 'Invalid credentials');
  }
  res.json({ success: true, user: sanitizeUser(user), token: generateToken(user) });
});

exports.userLogin = login(false);
exports.adminLogin = login(true);

/* --------------------------------- Profile -------------------------------- */
exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: sanitizeUser(req.user) });
});

exports.userProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(toStr(req.params.id)).select('-password');
  if (!user) throw httpError(404, 'User not found');
  res.json({ success: true, user: sanitizeUser(user) });
});

// PUT {name, phone, email?} — never touches `address`.
exports.updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(toStr(req.params.id));
  if (!user) throw httpError(404, 'User not found');

  if (req.body?.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!validName(name)) throw httpError(400, 'Please enter your real name');
    user.name = name;
  }
  if (req.body?.phone !== undefined) {
    const phone = normalizePhone(toStr(req.body.phone));
    if (!phone) throw httpError(400, 'Enter a valid 10-digit Indian mobile number');
    user.phone = phone;
  }
  if (req.body?.email !== undefined) {
    const email = normEmail(req.body.email);
    if (!email) {
      if (!user.isGuest) throw httpError(400, 'Email is required');
      user.email = undefined;
    } else {
      if (!EMAIL_RE.test(email) || email.length > 254) throw httpError(400, 'Enter a valid email address');
      if (email !== (user.email || '').toLowerCase()) {
        if (await User.exists({ ...emailFilter(email), _id: { $ne: user._id } })) {
          throw httpError(409, 'An account with this email already exists');
        }
        user.email = email;
      }
    }
  }
  await user.save();
  res.json({ success: true, user: sanitizeUser(user) });
});

/* ----------------------------- Account deletion ----------------------------- */
// DELETE /auth/account — DPDP erasure. Anonymises the user, removes saved addresses, push
// subscriptions and ticket contact details, revokes all tokens. Orders (incl. their address
// snapshot) are retained for GST/accounting record-keeping obligations.
exports.deleteAccount = asyncHandler(async (req, res) => {
  if (req.user.role === 'admin') throw httpError(403, 'Admin accounts cannot be deleted this way');
  const Ticket = require('../models/Ticket');
  const PushSubscription = require('../models/PushSubscription');
  const id = req.user._id;
  await User.updateOne(
    { _id: id },
    {
      $set: { name: 'Deleted user', address: [], isDeleted: true, deletedAt: new Date(), status: 'inactive', phone: '' },
      $unset: { email: 1, password: 1 },
      $inc: { tokenVersion: 1 },
    }
  );
  await Promise.all([
    PushSubscription.deleteMany({ userId: id }),
    Ticket.updateMany({ userId: id }, { $set: { fullName: 'Deleted user' }, $unset: { email: 1, phone: 1 } }),
  ]);
  res.json({ success: true, message: 'Your account has been deleted.' });
});

exports._internal = { generateToken, sanitizeUser };
