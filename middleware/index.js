const path = require('path');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const User = require('../models/User');
const { cloudinary, isCloudinaryConfigured, connectDB } = require('../config');
const { httpError, toStr } = require('../utils/http');

/* ------------------------------- Database -------------------------------- */

// Awaits the cached connection before handlers run. On failure we don't answer here:
// auth middleware still answers 401 for bad/missing tokens first, and the error handler
// turns any later DB error into a 503 (see server.js).
const ensureDb = (req, res, next) => {
  connectDB()
    .then(() => next())
    .catch((err) => {
      req.dbUnavailable = err;
      next();
    });
};

/* ---------------------------- Authentication ----------------------------- */

const readToken = (req) => {
  const h = req.header('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
};

const decodeToken = (token) => {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
};

const loadUser = async (decoded) => {
  if (!decoded?.id || typeof decoded.id !== 'string') return null;
  const user = await User.findById(decoded.id).select('-password');
  if (!user || user.status === 'inactive' || user.isDeleted) return null;
  // Revoked tokens (account deletion bumps tokenVersion).
  if ((decoded.tv || 0) !== (user.tokenVersion || 0)) return null;
  return user;
};

const verifyToken = async (req, res, next) => {
  try {
    const token = readToken(req);
    if (!token) return next(httpError(401, 'Authentication required'));
    const decoded = decodeToken(token);
    if (!decoded) return next(httpError(401, 'Invalid or expired token'));
    if (req.dbUnavailable) return next(httpError(503, 'Service temporarily unavailable'));
    const user = await loadUser(decoded);
    if (!user) return next(httpError(401, 'User not found or inactive'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

// Attaches req.user when a valid token is present; never rejects.
const optionalAuth = async (req, res, next) => {
  try {
    const decoded = decodeToken(readToken(req));
    if (decoded && !req.dbUnavailable) {
      const user = await loadUser(decoded);
      if (user) req.user = user;
    }
  } catch {
    /* ignore */
  }
  next();
};

const verifyAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return next(httpError(403, 'Admin access required'));
  next();
};

const isAdmin = (req) => req.user?.role === 'admin';


// Throws 403 unless the caller owns the resource (or is an admin).
const assertOwnerOrAdmin = (req, ownerId) => {
  if (isAdmin(req)) return;
  const owner = ownerId && (ownerId._id || ownerId);
  if (!owner || String(owner) !== String(req.user?._id)) {
    throw httpError(403, 'You do not have access to this resource');
  }
};

// Route guard: `req.params[param]` must be the caller's own user id (admins pass).
const requireOwnerOrAdmin = (param = 'userId') => (req, res, next) => {
  try {
    assertOwnerOrAdmin(req, req.params[param]);
    next();
  } catch (e) {
    next(e);
  }
};

/* ----------------------------- Rate limiting ----------------------------- */

// In-memory store: on serverless (Vercel) each warm instance keeps its own counters and
// counters reset on cold start, so this is a best-effort brake, not a hard global limit.
// Use a shared store (e.g. Redis/Upstash) if stronger guarantees are needed.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip || '')}|${toStr(req.body?.email).toLowerCase()}`,
  handler: (req, res) =>
    res.status(429).json({ success: false, message: 'Too many attempts. Please try again in a few minutes.' }),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ success: false, message: 'Too many sign-ups from this network. Please try later.' }),
});

// Guest checkout accounts: 10 per hour per IP.
const guestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' }),
});

/* -------------------------------- Uploads -------------------------------- */

// Vercel caps request bodies at ~4.5MB, so each file is limited to 4MB.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED = {
  images: {
    mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    exts: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'],
    label: 'JPG, PNG, WEBP, GIF or AVIF images',
  },
  video: {
    mimes: ['video/mp4', 'video/webm', 'video/quicktime'],
    exts: ['.mp4', '.webm', '.mov'],
    label: 'MP4, WEBM or MOV videos',
  },
};

const fileFilter = (req, file, cb) => {
  const rule = ALLOWED[file.fieldname];
  if (!rule) return cb(httpError(400, `Unexpected file field "${file.fieldname}"`));
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!rule.mimes.includes(file.mimetype) || !rule.exts.includes(ext)) {
    return cb(httpError(400, `Only ${rule.label} are allowed for ${file.fieldname}`));
  }
  cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: 4, fields: 50 },
});

const uploadToCloudinary = (buffer, resourceType = 'image', folder = 'chowdhry-items') => {
  if (!isCloudinaryConfigured || !cloudinary) {
    return Promise.reject(httpError(502, 'Media upload is not configured on the server'));
  }
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ resource_type: resourceType, folder }, (error, result) => {
        if (error) reject(httpError(502, `Media upload failed: ${error.message || 'upload error'}`));
        else resolve(result.secure_url);
      })
      .end(buffer);
  });
};

module.exports = {
  ensureDb,
  verifyToken,
  optionalAuth,
  verifyAdmin,
  isAdmin,
  assertOwnerOrAdmin,
  requireOwnerOrAdmin,
  authLimiter,
  registerLimiter,
  guestLimiter,
  upload,
  uploadToCloudinary,
  MAX_FILE_BYTES,
};
