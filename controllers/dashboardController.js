const Order = require('../models/Order');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Item = require('../models/Item');
const { asyncHandler, round2 } = require('../utils/http');
const { istTodayRange } = require('../utils/dates');

// "Today" is the IST calendar day. Order counts/revenue only ever include PAID orders,
// bucketed by confirmedAt (falling back to createdAt for legacy orders).
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const { start, end } = istTodayRange();
  const todayRange = { $gte: start, $lt: end };
  const paidToday = {
    paymentStatus: 'paid',
    $or: [{ confirmedAt: todayRange }, { confirmedAt: null, createdAt: todayRange }],
  };

  const [newOrders, totalCustomers, ticketsResolved, revenueAgg, failedOrders, pendingPayments, refundsPending, lowStock, openTickets] =
    await Promise.all([
      Order.countDocuments(paidToday),
      User.countDocuments({ status: 'active', role: 'user' }),
      Ticket.countDocuments({ status: 'resolved', updatedAt: todayRange }),
      Order.aggregate([{ $match: paidToday }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.countDocuments({ paymentStatus: 'failed', createdAt: todayRange }),
      Order.countDocuments({ paymentStatus: { $in: ['pending', 'failed'] }, status: { $ne: 'cancelled' }, createdAt: todayRange }),
      Order.countDocuments({ refundStatus: 'pending' }),
      Item.countDocuments({ status: { $ne: 'inactive' }, stockQty: { $lte: 5 } }),
      Ticket.countDocuments({ status: { $in: ['open', 'in-progress'] } }),
    ]);

  res.json({
    success: true,
    newOrders,
    totalCustomers,
    ticketsResolved,
    revenueToday: round2(revenueAgg[0]?.total || 0),
    failedOrders,
    pendingPayments,
    refundsPending,
    lowStock,
    openTickets,
  });
});
