const mongoose = require('mongoose');
const { isGorakhpurPincode } = require('../config/gorakhpurPincodes');

const refundSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0 },
  reason: String,
  mode: { type: String, enum: ['razorpay', 'manual'], required: true },
  razorpayRefundId: String,
  status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending' },
  error: String,
  arn: String,               // bank reference (acquirer_data.arn) once Razorpay reports it
  creditNoteNumber: String,  // {prefix}/CN/{FY}/{seq}, assigned when processed
  createdAt: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'user' }
});

const shippingAddressSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  street: String,
  apartment: String,
  city: String,
  state: String,
  postcode: String,
  phone: String,
  altPhone: String,
  email: String
}, { _id: false });

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
  // Snapshot of the delivery address captured at create-order (invoice/admin views prefer it).
  shippingAddress: { type: shippingAddressSchema, default: undefined },
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
    name: String, // snapshot of the item name at purchase time
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
      default: 500 // grams per unit
    },
    // Units actually removed from stock at payment confirmation (absent on legacy orders).
    stockDeducted: { type: Number },
    gstRate: { type: Number },  // % snapshot at checkout (absent on legacy orders = 5)
    hsnCode: { type: String }
  }],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  platformFee: {
    type: Number,
    default: 0
  },
  // Tax snapshot at checkout (legacy orders: absent → regular, 5% added on top).
  gstScheme: { type: String, enum: ['regular', 'composition', 'unregistered'] },
  pricesIncludeGst: { type: Boolean },
  gstAmount: { type: Number },
  platformFeePercent: { type: Number },
  // Tax invoice number, assigned once on first successful payment.
  invoiceNumber: { type: String },
  invoiceDate: { type: Date },
  currency: {
    type: String,
    default: 'INR'
  },
  // Customer contact for this order (editable post-order; falls back to address phone if empty)
  contactPhone: { type: String },
  altPhone: { type: String },
  // Delivery date is chosen by admin after accepting the order (no auto ETA)
  deliveryDate: { type: Date },
  // Timeline timestamps (set as statuses change)
  paidAt: { type: Date },
  shippedAt: { type: Date },
  outForDeliveryAt: { type: Date },
  deliveredAt: { type: Date },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'],
    default: 'pending'
  },
  deliveryProvider: {
    type: String,
    enum: ['DELHIVERY', 'SELF'],
    default: 'SELF',
    validate: {
      validator: function(value) {
        // Enforce GKP business rule at schema level
        if (value === 'DELHIVERY' && this.deliveryPincode && isGorakhpurPincode(this.deliveryPincode)) {
          return false;
        }
        return ['DELHIVERY', 'SELF'].includes(value);
      },
      message: 'BLOCKED: Delhivery cannot be used for Gorakhpur pincodes. Use self delivery.'
    }
  },
  deliveryProviderDisplay: {
    type: String,
    default: function() {
      return this.deliveryProvider === 'SELF'
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
    type: String
  },
  shipping: {
    provider: {
      type: String,
      default: function() {
        return this.deliveryProvider; // MUST match deliveryProvider
      }
    },
    total: Number,
    breakdown: { type: mongoose.Schema.Types.Mixed },
    charged: { type: Boolean, default: false },
    refunded: { type: Boolean, default: false }
  },
  totalWeight: Number,
  distance: { type: Number, default: 0 }, // Distance in km (null when geocoding failed)
  shipmentAttempts: { type: Number, default: 0 },
  shipmentCreated: { type: Boolean, default: false },
  shipmentLastError: String,
  rtoCharges: Number,
  logisticsLoss: Number,
  // Prepaid only — there is no COD anywhere.
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
  // Razorpay attempts. `amount` is ALWAYS in paise (as Razorpay reports it);
  // API responses add `amountRupees`.
  razorpayData: [{
    orderId: String,
    paymentId: String,
    signature: String,
    amount: Number, // paise
    currency: String,
    status: String,
    method: String,
    errorReason: String,
    source: { type: String, enum: ['api', 'webhook', 'verify_payment', 'manual_confirmation', 'reconcile'], default: 'api' },
    signatureVerified: { type: Boolean, default: false },
    attemptNumber: { type: Number, default: 1 },
    failureCode: String,
    failureDescription: String,
    note: String,
    createdAt: { type: Date, default: Date.now }
  }],
  lastPaymentError: String,
  confirmedAt: Date,
  cancelledAt: Date,
  rtoHandled: { type: Boolean, default: false },
  // ----- Business-owner order management -----
  cancelReason: String,
  refunds: [refundSchema],
  refundedAmount: { type: Number, default: 0 }, // committed (pending + processed) refunds, rupees
  refundStatus: { type: String, enum: ['none', 'pending', 'partial', 'processed', 'failed'], default: 'none' },
  stockRestored: { type: Boolean, default: false },
  // Append-only audit trail of status / payment / refund changes.
  statusHistory: [{
    _id: false,
    status: String,
    deliveryStatus: String,
    paymentStatus: String,
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    note: String
  }],
  isDelayed: { type: Boolean, default: false },
  delayReason: String,
  adminNotes: String
}, {
  timestamps: true
});

// Method to calculate weight (single source of truth)
orderSchema.methods.calculateWeight = function() {
  return this.items.reduce((sum, item) => sum + (item.weight || 500) * item.quantity, 0);
};

// Pre-save middleware for consistency and business rules
orderSchema.pre('save', function(next) {
  if (this.shipping && this.deliveryProvider) {
    this.shipping.provider = this.deliveryProvider;
  }

  // Self delivery orders NEVER have waybill
  if (this.deliveryProvider === 'SELF' && this.waybill) {
    this.waybill = undefined;
    this.shipmentCreated = false;
  }

  if (this.isModified('status')) {
    if (this.status === 'confirmed' && !this.confirmedAt) this.confirmedAt = new Date();
    if (this.status === 'cancelled' && !this.cancelledAt) this.cancelledAt = new Date();
  }
  if (this.isModified('deliveryStatus') && this.deliveryStatus === 'DELIVERED' && !this.deliveredAt) {
    this.deliveredAt = new Date();
  }

  next();
});

// Indexes for better query performance
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ waybill: 1 }, { sparse: true });
orderSchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true });
orderSchema.index({ 'razorpayData.orderId': 1 });
orderSchema.index({ 'razorpayData.paymentId': 1 });
orderSchema.index({ 'refunds.razorpayRefundId': 1 }, { sparse: true });

module.exports = mongoose.model('Order', orderSchema);
