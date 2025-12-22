const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
    index: true
  },
  addressId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
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
    }
  }],
  distance: {
    type: Number,
    min: 0
  },
  deliveryFee: {
    type: Number,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'],
    default: 'pending',
    index: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending',
    index: true
  },
  razorpayData: [{
    orderId: String,
    paymentId: String,
    signature: String,
    amount: Number,
    currency: String,
    status: String,
    method: String,
    bank: String,
    wallet: String,
    vpa: String,
    email: String,
    contact: String,
    fee: Number,
    tax: Number,
    errorCode: String,
    errorDescription: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

// Indexes for better query performance
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);