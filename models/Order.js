const mongoose = require('mongoose');
const { isGorakhpurPincode } = require('../config/gorakhpurPincodes');

const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true
  },
  addressId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  // Store pincode for validation (populated from address)
  deliveryPincode: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^[0-9]{6}$/.test(v);
      },
      message: 'Invalid pincode format'
    }
  },
  items: [{
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    weight: {
      type: Number,
      default: 500 // Default 500g per item
    }
  }],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'],
    default: 'pending'
  },
  deliveryProvider: {
    type: String,
    enum: ['DELHIVERY', 'SELF'],
    default: 'DELHIVERY',
    validate: {
      validator: function(value) {
        // CRITICAL: Enforce GKP business rule at schema level
        if (value === 'DELHIVERY') {
          // Use deliveryPincode field for validation
          if (this.deliveryPincode && isGorakhpurPincode(this.deliveryPincode)) {
            return false; // Block Delhivery for GKP
          }
        }
        return ['DELHIVERY', 'SELF'].includes(value);
      },
      message: 'BLOCKED: Delhivery cannot be used for Gorakhpur pincodes. Use self delivery.'
    }
  },
  deliveryProviderDisplay: {
    type: String,
    default: function() {
      return this.deliveryProvider === 'self' 
        ? 'Delivered by Chowdhary Sweets (Local Delivery)'
        : 'Courier Delivery via Delhivery';
    }
  },
  deliveryStatus: {
    type: String,
    enum: ['PENDING', 'SHIPMENT_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RTO', 'PRE_PICKUP_CANCEL'],
    default: 'PENDING'
  },
  waybill: {
    type: String,
    sparse: true
  },
  shipping: {
    provider: { 
      type: String, 
      default: function() {
        return this.deliveryProvider; // MUST match deliveryProvider
      }
    },
    total: Number,
    breakdown: {
      baseRate: Number,
      weightRate: Number,
      fuelSurcharge: Number
    },
    charged: { type: Boolean, default: false },
    refunded: { type: Boolean, default: false }
  },
  totalWeight: Number,
  distance: { type: Number, default: 0 }, // Distance in km
  shipmentAttempts: { type: Number, default: 0 },
  shipmentCreated: { type: Boolean, default: false },
  shipmentLastError: String,
  rtoCharges: Number,
  logisticsLoss: Number,
  paymentMode: {
    type: String,
    enum: ['PREPAID'],
    default: 'PREPAID'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'cancelled'],
    default: 'pending'
  },
  razorpayData: [{
    orderId: String,
    paymentId: String,
    signature: String,
    amount: Number,
    currency: String,
    status: String,
    method: String,
    errorReason: String,
    source: { type: String, enum: ['api', 'webhook', 'verify_payment', 'manual_confirmation'], default: 'api' },
    signatureVerified: { type: Boolean, default: false },
    attemptNumber: { type: Number, default: 1 },
    failureCode: String,
    failureDescription: String,
    createdAt: { type: Date, default: Date.now }
  }],
  confirmedAt: Date,
  cancelledAt: Date,
  rtoHandled: { type: Boolean, default: false }
}, {
  timestamps: true
});

// Method to calculate weight (single source of truth)
orderSchema.methods.calculateWeight = function() {
  return this.items.reduce((sum, item) => {
    return sum + (item.weight || 500) * item.quantity;
  }, 0);
};

// Pre-save middleware for consistency and business rules
orderSchema.pre('save', function(next) {
  // Enforce shipping.provider = deliveryProvider consistency
  if (this.shipping && this.deliveryProvider) {
    this.shipping.provider = this.deliveryProvider;
  }
  
  // Self delivery orders NEVER have waybill
  if (this.deliveryProvider === 'SELF' && this.waybill) {
    this.waybill = undefined;
    this.shipmentCreated = false;
  }
  
  // Auto-set timestamps
  if (this.isModified('status')) {
    if (this.status === 'confirmed' && !this.confirmedAt) {
      this.confirmedAt = new Date();
    }
    if (this.status === 'cancelled' && !this.cancelledAt) {
      this.cancelledAt = new Date();
    }
  }
  
  next();
});

// Indexes for better query performance
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ waybill: 1 });

module.exports = mongoose.model('Order', orderSchema);