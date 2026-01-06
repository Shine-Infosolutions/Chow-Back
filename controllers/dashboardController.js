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

    const todayRange = { $gte: today, $lt: tomorrow };

    const [
      newOrders,
      totalCustomers,
      ticketsResolved,
      revenueToday,
      failedOrders
    ] = await Promise.all([
      Order.countDocuments({ 
        createdAt: todayRange,
        status: { $ne: 'failed' }
      }),
      User.countDocuments({ status: 'active' }),
      Ticket.countDocuments({ 
        status: 'resolved',
        updatedAt: todayRange
      }),
      Order.aggregate([
        {
          $match: {
            createdAt: todayRange,
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
        createdAt: todayRange,
        $or: [
          { status: 'failed' },
          { paymentStatus: 'failed' },
          { status: 'cancelled', paymentStatus: 'cancelled' }
        ]
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

