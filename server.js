const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
require('dotenv').config();

const startServer = async () => {
  try {
    // Connect to database first
    await connectDB();
    
    const app = express();
    const PORT = process.env.PORT || 5000;

    // Middleware
    app.use(cors({
      origin: ['https://chow-front.vercel.app', 'http://localhost:3000', 'http://localhost:5173'],
      credentials: true
    }));
    app.use(express.json());

    // Routes
    const categoryRoutes = require('./routes/categoryRoutes');
    const subcategoryRoutes = require('./routes/subcategoryRoutes');
    const itemRoutes = require('./routes/itemRoutes');
    const dashboardRoutes = require('./routes/dashboardRoutes');
    const searchRoutes = require('./routes/searchRoutes');
    const ticketRoutes = require('./routes/tickets');
    const authRoutes = require('./routes/authRoutes');
    const orderRoutes = require('./routes/orderRoutes');
    const userRoutes = require('./routes/userRoutes');
    const adminRoutes = require('./routes/adminRoutes');

    app.use('/api/categories', categoryRoutes);
    app.use('/api/subcategories', subcategoryRoutes);
    app.use('/api/items', itemRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use('/api/search', searchRoutes);
    app.use('/api/tickets', ticketRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/orders', orderRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/admin', adminRoutes);

    // Basic route
    app.get('/', (req, res) => {
      res.json({ message: 'Chowdhry Backend API' });
    });

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();