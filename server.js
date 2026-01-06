const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { connectDB } = require("./config");

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Configuration
const corsOptions = {
  origin: [
    "https://chow-front.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Favicon handler
app.get("/favicon.ico", (req, res) => res.status(204).end());

// API Routes
const routes = {
  "/api/categories": require("./routes/categoryRoutes"),
  "/api/subcategories": require("./routes/subcategoryRoutes"),
  "/api/items": require("./routes/itemRoutes"),
  "/api/dashboard": require("./routes/dashboardRoutes"),
  "/api/search": require("./routes/searchRoutes"),
  "/api/tickets": require("./routes/tickets"),
  "/api/auth": require("./routes/authRoutes"),
  "/api/orders": require("./routes/orderRoutes"),
  "/api/users": require("./routes/userRoutes"),
  "/api/admin": require("./routes/adminRoutes"),
  "/api": require("./routes/distanceRoutes"),
  "/api/payment": require("./routes/paymentRoutes"),
  "/api/sweet-deals": require("./routes/sweetDealRoutes"),
  "/api/delhivery": require("./routes/delhiveryRoutes"),
  "/api/delivery": require("./routes/deliveryRoutes")
};

Object.entries(routes).forEach(([path, router]) => {
  app.use(path, router);
});

// Health check
app.get("/", (req, res) => {
  res.json({ 
    message: "Chowdhry Backend API running",
    status: "healthy",
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({ 
    success: false,
    error: isDev ? err.message : 'Internal server error'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason?.message || reason);
  // Don't exit in production, just log
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error?.message || error);
  // Exit gracefully
  process.exit(1);
});

// Start server
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err);
    process.exit(1);
  });
