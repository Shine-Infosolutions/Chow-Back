const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'admin'], required: true },
  senderName: { type: String },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const ticketSchema = new mongoose.Schema({
  // Who raised it (set when a logged-in customer opens a ticket)
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
  // Order this ticket is about (for order complaints/queries) + optional item
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  itemName: { type: String },

  fullName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  subject: { type: String, required: true },
  // First message text — kept for list previews / backward compatibility
  message: { type: String },

  type: {
    type: String,
    enum: ['custom-request', 'order-issue', 'complaint', 'query', 'return-refund', 'general'],
    default: 'general'
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open'
  },

  // 2-way conversation thread
  messages: [messageSchema],
  lastReplyBy: { type: String, enum: ['user', 'admin'], default: 'user' }
}, {
  timestamps: true
});

module.exports = mongoose.model('Ticket', ticketSchema);
