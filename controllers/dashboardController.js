const Order = require('../models/Order');
const User = require('../models/User');
const Ticket = require('../models/Ticket');

// Get dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      newOrders,
      totalCustomers,
      ticketsResolved,
      revenueToday,
      failedOrders
    ] = await Promise.all([
      Order.countDocuments({ 
        createdAt: { $gte: today, $lt: tomorrow },
        status: { $ne: 'failed' }
      }),
      User.countDocuments({ status: 'active' }),
      Ticket.countDocuments({ 
        status: 'resolved',
        updatedAt: { $gte: today, $lt: tomorrow }
      }),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: today, $lt: tomorrow },
            paymentStatus: 'paid'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' }
          }
        }
      ]),
      Order.countDocuments({
        createdAt: { $gte: today, $lt: tomorrow },
        status: 'failed'
      })
    ]);

    res.json({
      newOrders,
      totalCustomers,
      ticketsResolved,
      revenueToday: revenueToday[0]?.total || 0,
      failedOrders
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};