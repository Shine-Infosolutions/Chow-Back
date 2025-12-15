const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: false
  },
  subject: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: false
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open'
  },
  type: {
    type: String,
    enum: ['order-failed', 'payment-issue', 'delivery-problem', 'general'],
    default: 'general'
  },
  resolutionNotes: {
    type: String,
    required: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Ticket', ticketSchema);