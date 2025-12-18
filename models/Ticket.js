const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  phone: {
    type: String
  },
  subject: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open'
  },
  type: {
    type: String,
    enum: ['custom-request', 'order-issue', 'general'],
    default: 'custom-request'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Ticket', ticketSchema);