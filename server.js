const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
require('dotenv').config();

const CORS_ORIGINS = [
  'https://chow-front.vercel.app', 
  'http://localhost:3000', 
  'http://localhost:5173'
];

const routes = [
  { path: '/api/categories', module: './routes/categoryRoutes' },
  { path: '/api/subcategories', module: './routes/subcategoryRoutes' },
  { path: '/api/items', module: './routes/itemRoutes' },
  { path: '/api/dashboard', module: './routes/dashboardRoutes' },
  { path: '/api/search', module: './routes/searchRoutes' },
  { path: '/api/tickets', module: './routes/tickets' },
  { path: '/api/auth', module: './routes/authRoutes' },
  { path: '/api/orders', module: './routes/orderRoutes' },
  { path: '/api/users', module: './routes/userRoutes' },
  { path: '/api/admin', module: './routes/adminRoutes' },
  { path: '/api', module: './routes/distanceRoutes' },
  { path: '/api/payment', module: './routes/paymentRoutes' }
];

const startServer = async () => {
  try {
    await connectDB();
    
    const app = express();
    const PORT = process.env.PORT || 5000;

    // Middleware
    app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
    app.use(express.json());

    // Routes
    routes.forEach(({ path, module }) => {
      app.use(path, require(module));
    });

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