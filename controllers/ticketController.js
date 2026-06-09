const Ticket = require('../models/Ticket');

// Create ticket (contact form OR order-linked support request)
exports.createTicket = async (req, res) => {
  try {
    const { fullName, email, phone, subject, message, type, userId, orderId, itemName } = req.body;
    if (!fullName || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'fullName, email, subject, and message are required' });
    }

    const ticket = new Ticket({
      fullName,
      email,
      phone,
      subject,
      message,
      type: type || (orderId ? 'order-issue' : 'general'),
      userId: userId || undefined,
      orderId: orderId || undefined,
      itemName: itemName || undefined,
      messages: [{ sender: 'user', senderName: fullName, message }],
      lastReplyBy: 'user'
    });

    await ticket.save();
    res.status(201).json({ success: true, ticket });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all tickets (admin)
exports.getAllTickets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const tickets = await Ticket.find()
      .populate('orderId', '_id totalAmount status paymentStatus')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Ticket.countDocuments();

    res.json({
      success: true,
      tickets,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get tickets raised by a specific customer
exports.getMyTickets = async (req, res) => {
  try {
    const tickets = await Ticket.find({ userId: req.params.userId })
      .populate('orderId', '_id totalAmount status')
      .sort({ updatedAt: -1 });
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get ticket by ID (full thread)
exports.getTicketById = async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ticket ID' });
    }
    const ticket = await Ticket.findById(req.params.id).populate('orderId', '_id totalAmount status paymentStatus');
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    res.json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reply to a ticket — sender role decided by the authenticated user
exports.replyToTicket = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && (!ticket.userId || String(ticket.userId) !== String(req.user._id))) {
      return res.status(403).json({ success: false, message: 'Not authorized to reply to this ticket' });
    }

    const sender = isAdmin ? 'admin' : 'user';
    ticket.messages.push({
      sender,
      senderName: isAdmin ? 'Support Team' : (ticket.fullName || req.user.name),
      message: message.trim()
    });
    ticket.lastReplyBy = sender;

    // Move status along sensibly
    if (isAdmin && ticket.status === 'open') ticket.status = 'in-progress';
    if (!isAdmin && ticket.status === 'resolved') ticket.status = 'open'; // customer reopened

    await ticket.save();
    res.json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update ticket (admin — status changes etc.)
exports.updateTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    res.json({ success: true, ticket });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete ticket (admin)
exports.deleteTicket = async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ticket ID' });
    }
    const ticket = await Ticket.findByIdAndDelete(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    res.json({ success: true, message: 'Ticket deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
