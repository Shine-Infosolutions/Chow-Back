const jwt = require('jsonwebtoken');
const multer = require('multer');
const User = require('../models/User');
const Order = require('../models/Order');
const { cloudinary } = require('../config');
const { isGorakhpurPincode } = require('../config/gorakhpurPincodes');

// Authentication Middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ message: 'Access denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user || user.status === 'inactive') {
      return res.status(401).json({ message: 'User not found or inactive' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const verifyAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Delivery Validation Middleware
const preventGorakhpurDelhivery = async (req, res, next) => {
  try {
    const isDelhiveryOperation = req.originalUrl.includes('/delhivery/') || 
                                req.body?.provider === 'delhivery' ||
                                req.body?.deliveryProvider === 'delhivery';

    if (!isDelhiveryOperation) return next();

    let pincode = req.body?.pincode || req.body?.deliveryPincode || req.params?.pincode;
    
    if (!pincode && req.body?.orderId) {
      const order = await Order.findById(req.body.orderId).populate('userId', 'address');
      if (order?.addressId) {
        const deliveryAddress = order.userId.address?.find(
          addr => String(addr._id) === String(order.addressId)
        );
        pincode = deliveryAddress?.postcode;
      }
    }

    if (pincode && isGorakhpurPincode(pincode)) {
      console.error(`BLOCKED: Attempted Delhivery operation for Gorakhpur pincode ${pincode}`);
      return res.status(403).json({
        success: false,
        error: 'CRITICAL: Delhivery operations are not allowed for Gorakhpur deliveries'
      });
    }

    next();
  } catch (error) {
    console.error('Delivery validation middleware error:', error);
    next();
  }
};

// Upload Configuration
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    images: 'image/',
    video: 'video/'
  };
  
  const expectedType = allowedTypes[file.fieldname];
  if (!expectedType) {
    return cb(new Error('Unexpected field'), false);
  }
  
  if (file.mimetype.startsWith(expectedType)) {
    cb(null, true);
  } else {
    cb(new Error(`Only ${expectedType.slice(0, -1)} files are allowed for ${file.fieldname}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

const uploadToCloudinary = (buffer, resourceType = 'image') => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder: 'chowdhry-items'
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    ).end(buffer);
  });
};

module.exports = {
  verifyToken,
  verifyAdmin,
  preventGorakhpurDelhivery,
  upload,
  uploadToCloudinary
};