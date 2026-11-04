const mongoose = require("mongoose");
const cloudinary = require('cloudinary').v2;
const Razorpay = require("razorpay");

// NOTE: `strictQuery:false` used to be set here. Mongoose 8 already defaults to false, so the
// explicit override was removed. Untrusted input is coerced to strings / stripped of `$` keys
// at the edge (see server.js + utils/http.js), which is what actually prevents operator injection.
// `sanitizeFilter` is deliberately NOT enabled globally: it would also neuter our own `$in`/`$gte` filters.

// ---------------------------------------------------------------------------
// Database: lazy, cached connection (safe for serverless — one connection per warm instance).
// ---------------------------------------------------------------------------
let connPromise = null;

mongoose.connection.on('disconnected', () => { connPromise = null; });
mongoose.connection.on('error', () => { connPromise = null; });

const connectDB = () => {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (connPromise) return connPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) return Promise.reject(new Error("MONGODB_URI not defined"));

  connPromise = mongoose
    .connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 5000 })
    .then((m) => {
      console.log("MongoDB connected");
      return m.connection;
    })
    .catch((err) => {
      connPromise = null; // allow the next request to retry
      console.error("MongoDB connection failed:", err.message);
      throw err;
    });
  return connPromise;
};

// Cloudinary Configuration
const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
const isCloudinaryConfigured = Boolean(CLOUDINARY_CLOUD_NAME &&
  CLOUDINARY_API_KEY &&
  CLOUDINARY_API_SECRET &&
  CLOUDINARY_CLOUD_NAME !== 'your_cloud_name' &&
  CLOUDINARY_API_KEY !== 'your_api_key' &&
  CLOUDINARY_API_SECRET !== 'your_api_secret');

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
} else {
  console.warn('Cloudinary not configured - image uploads will be disabled');
}

// Razorpay Configuration
const { RAZORPAY_KEY_ID, RAZORPAY_SECRET } = process.env;
let razorpayInstance = null;

if (RAZORPAY_KEY_ID && RAZORPAY_SECRET) {
  razorpayInstance = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_SECRET,
  });
} else {
  console.warn("Razorpay credentials missing - payment features will be disabled");
}

module.exports = {
  connectDB,
  cloudinary: isCloudinaryConfigured ? cloudinary : null,
  razorpay: razorpayInstance,
  isCloudinaryConfigured
};
