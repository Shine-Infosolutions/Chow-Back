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
  "/api/categories": "./routes/categoryRoutes",
  "/api/subcategories": "./routes/subcategoryRoutes",
  "/api/items": "./routes/itemRoutes",
  "/api/dashboard": "./routes/dashboardRoutes",
  "/api/search": "./routes/searchRoutes",
  "/api/tickets": "./routes/tickets",
  "/api/auth": "./routes/authRoutes",
  "/api/orders": "./routes/orderRoutes",
  "/api/users": "./routes/userRoutes",
  "/api/admin": "./routes/adminRoutes",
  "/api": "./routes/distanceRoutes",
  "/api/payment": "./routes/paymentRoutes",
  "/api/sweet-deals": "./routes/sweetDealRoutes",
  "/api/delhivery": "./routes/delhiveryRoutes",
  "/api/delivery": "./routes/deliveryRoutes"
};

Object.entries(routes).forEach(([path, route]) => {
  app.use(path, require(route));
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
  console.error("Unhandled error:", err);
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({ 
    success: false,
    error: isDev ? err.message : 'Internal server error',
    ...(isDev && { stack: err.stack })
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
