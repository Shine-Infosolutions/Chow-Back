const mongoose = require("mongoose");
const cloudinary = require('cloudinary').v2;
const Razorpay = require("razorpay");

// Mongoose configuration
mongoose.set('strictQuery', false);

// Database Configuration
let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not defined");

  try {
    await mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    });

    isConnected = true;
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    throw err;
  }
};

// Cloudinary Configuration
const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
const isCloudinaryConfigured = CLOUDINARY_CLOUD_NAME && 
  CLOUDINARY_API_KEY && 
  CLOUDINARY_API_SECRET && 
  CLOUDINARY_CLOUD_NAME !== 'your_cloud_name' &&
  CLOUDINARY_API_KEY !== 'your_api_key' &&
  CLOUDINARY_API_SECRET !== 'your_api_secret';

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
  console.log('Cloudinary configured');
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