const Ticket = require('../models/Ticket');
const Order = require('../models/Order');
const { asyncHandler, httpError, toStr, isValidId, parsePagination } = require('../utils/http');
const { isAdmin, assertOwnerOrAdmin } = require('../middleware');
const { normalizePhone } = require('../utils/addressValidation');

const TYPES = ['custom-request', 'order-issue', 'complaint', 'query', 'return-refund', 'general'];
const STATUSES = ['open', 'in-progress', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const loadTicket = async (id) => {
  if (!isValidId(toStr(id))) throw httpError(400, 'Invalid ticket ID');
  const ticket = await Ticket.findById(id).populate('orderId', '_id totalAmount status paymentStatus');
  if (!ticket) throw httpError(404, 'Ticket not found');
  return ticket;
};

// POST /tickets — public. userId comes from the token when present (never from the body).
exports.createTicket = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const user = req.user;
  const fullName = toStr(b.fullName).slice(0, 100) || user?.name || '';
  const email = toStr(b.email).toLowerCase().slice(0, 254) || user?.email || '';
  const phoneRaw = toStr(b.phone) || user?.phone || '';
  const subject = toStr(b.subject).slice(0, 200);
  const message = toStr(b.message).slice(0, 5000);

  if (!fullName || !subject || !message) throw httpError(400, 'fullName, subject and message are required');
  if (!email && !phoneRaw) throw httpError(400, 'An email or phone number is required');
  if (email && !EMAIL_RE.test(email)) throw httpError(400, 'Enter a valid email address');
  const phone = phoneRaw ? normalizePhone(phoneRaw) || phoneRaw.slice(0, 20) : undefined;

  let orderId;
  const rawOrderId = toStr(b.orderId);
  if (rawOrderId) {
    if (!isValidId(rawOrderId)) throw httpError(400, 'Invalid order id');
    // Only link orders the caller owns.
    if (user) {
      const order = await Order.findById(rawOrderId).select('userId');
      if (order && (isAdmin(req) || String(order.userId) === String(user._id))) orderId = order._id;
    }
  }

  const type = TYPES.includes(toStr(b.type)) ? toStr(b.type) : orderId ? 'order-issue' : 'general';
  const ticket = await new Ticket({
    fullName,
    email: email || undefined,
    phone,
    subject,
    message,
    type,
    userId: user?._id,
    orderId,
    itemName: toStr(b.itemName).slice(0, 200) || undefined,
    messages: [{ sender: 'user', senderName: fullName, message }],
    lastReplyBy: 'user',
  }).save();

  res.status(201).json({ success: true, ticket });
});

exports.getAllTickets = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 100 });
  const filter = {};
  const status = toStr(req.query.status);
  if (STATUSES.includes(status)) filter.status = status;
  const [tickets, total] = await Promise.all([
    Ticket.find(filter).populate('orderId', '_id totalAmount status paymentStatus').sort({ updatedAt: -1 }).skip(skip).limit(limit),
    Ticket.countDocuments(filter),
  ]);
  res.json({ success: true, tickets, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

exports.getMyTickets = asyncHandler(async (req, res) => {
  const userId = toStr(req.params.userId);
  if (!isValidId(userId)) throw httpError(400, 'Invalid user id');
  const tickets = await Ticket.find({ userId }).populate('orderId', '_id totalAmount status').sort({ updatedAt: -1 }).limit(200);
  res.json({ success: true, tickets });
});

exports.getTicketById = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  assertOwnerOrAdmin(req, ticket.userId);
  res.json({ success: true, ticket });
});

exports.replyToTicket = asyncHandler(async (req, res) => {
  const message = toStr(req.body?.message).slice(0, 5000);
  if (!message) throw httpError(400, 'Message is required');

  const ticket = await loadTicket(req.params.id);
  assertOwnerOrAdmin(req, ticket.userId);

  const admin = isAdmin(req);
  const sender = admin ? 'admin' : 'user';
  ticket.messages.push({ sender, senderName: admin ? 'Support Team' : (ticket.fullName || req.user.name), message });
  ticket.lastReplyBy = sender;
  if (admin && ticket.status === 'open') ticket.status = 'in-progress';
  if (!admin && ticket.status === 'resolved') ticket.status = 'open'; // customer reopened

  await ticket.save();
  res.json({ success: true, ticket });
});

// Admin: only status / priority may change.
exports.updateTicket = asyncHandler(async (req, res) => {
  const update = {};
  const status = toStr(req.body?.status);
  const priority = toStr(req.body?.priority);
  if (status) {
    if (!STATUSES.includes(status)) throw httpError(400, 'Invalid status');
    update.status = status;
  }
  if (priority) {
    if (!PRIORITIES.includes(priority)) throw httpError(400, 'Invalid priority');
    update.priority = priority;
  }
  if (!Object.keys(update).length) throw httpError(400, 'Nothing to update (status or priority required)');
  if (!isValidId(toStr(req.params.id))) throw httpError(400, 'Invalid ticket ID');

  const ticket = await Ticket.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  if (!ticket) throw httpError(404, 'Ticket not found');
  res.json({ success: true, ticket });
});

exports.deleteTicket = asyncHandler(async (req, res) => {
  if (!isValidId(toStr(req.params.id))) throw httpError(400, 'Invalid ticket ID');
  const ticket = await Ticket.findByIdAndDelete(req.params.id);
  if (!ticket) throw httpError(404, 'Ticket not found');
  res.json({ success: true, message: 'Ticket deleted successfully' });
});
