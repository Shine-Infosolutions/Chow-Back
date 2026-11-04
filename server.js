const express = require("express");
const cors = require("cors");
const multer = require("multer");
const helmet = require("helmet");
require("dotenv").config();
const { connectDB } = require("./config");
const { ensureDb } = require("./middleware");
const { stripMongoOperators } = require("./utils/http");

const app = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === "production";

// Behind Vercel's proxy: makes req.protocol https and req.ip the client IP (rate limiting).
app.set("trust proxy", 1);
// Simple query parser: values are strings or arrays of strings — never nested objects
// like ?status[$ne]=x (prevents query-string operator injection).
app.set("query parser", "simple");
app.disable("x-powered-by");

// Security headers for a JSON API. CSP is not needed for JSON; the invoice HTML page sets its own headers.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(
  cors({
    origin: [
      "https://chow-front-five.vercel.app",
      "https://www.chowdhrysweethouse.in",
      "https://chowdhrysweethouse.in",
      "http://localhost:3000",
      "http://localhost:5173",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// JSON body + raw bytes for webhook HMAC verification (Razorpay signs the exact raw body).
app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Strip `$`-prefixed / dotted keys from bodies (operator injection), after multer too.
const sanitizeBody = (req, res, next) => {
  if (req.body && typeof req.body === "object") stripMongoOperators(req.body);
  next();
};
app.use(sanitizeBody);

app.get("/favicon.ico", (req, res) => res.status(204).end());

app.get("/", (req, res) => {
  res.json({ message: "Chowdhry Backend API running", status: "healthy", timestamp: new Date().toISOString() });
});

// Lazily connect (cached) before any API handler runs.
app.use("/api", ensureDb);

const routes = [
  ["/api/categories", require("./routes/categoryRoutes")],
  ["/api/subcategories", require("./routes/subcategoryRoutes")],
  ["/api/items", require("./routes/itemRoutes")],
  ["/api/dashboard", require("./routes/dashboardRoutes")],
  ["/api/reports", require("./routes/reportRoutes")],
  ["/api/settings", require("./routes/settingsRoutes").settingsRouter],
  ["/api/pages", require("./routes/settingsRoutes").pagesRouter],
  ["/api/cron", require("./routes/cronRoutes")],
  ["/api/search", require("./routes/searchRoutes")],
  ["/api/tickets", require("./routes/tickets")],
  ["/api/auth", require("./routes/authRoutes")],
  ["/api/orders", require("./routes/orderRoutes")],
  ["/api/users", require("./routes/userRoutes")],
  ["/api/address", require("./routes/addressRoutes")],
  ["/api/push", require("./routes/pushRoutes")],
  ["/api/admin", require("./routes/adminRoutes")],
  ["/api/payment", require("./routes/paymentRoutes")],
  ["/api/sweet-deals", require("./routes/sweetDealRoutes")],
  ["/api/delhivery", require("./routes/delhiveryRoutes")],
  ["/api/delivery", require("./routes/deliveryRoutes")],
  ["/api", require("./routes/distanceRoutes")],
];
routes.forEach(([path, router]) => app.use(path, sanitizeBody, router));
app.get("/api/sitemap.xml", require("./controllers/sitemapController").sitemap);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Central error handler: { success:false, message } with a proper status.
// 5xx messages are hidden in production.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = Number(err.status || err.statusCode) || 500;
  let message = err.message || "Internal server error";
  const extra = err.extra || {};

  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "File too large (max 4MB per file)" : `Upload error: ${err.message}`;
  } else if (err.name === "ValidationError") {
    status = 400;
    message = Object.values(err.errors || {})[0]?.message || "Validation failed";
  } else if (err.name === "CastError") {
    status = 400;
    message = `Invalid ${err.path || "value"}`;
  } else if (err.code === 11000) {
    status = 409;
    message = `Duplicate value for ${Object.keys(err.keyValue || {})[0] || "a unique field"}`;
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    message = "Invalid JSON body";
  } else if (err.type === "entity.too.large") {
    status = 413;
    message = "Request body too large";
  } else if (
    status >= 500 &&
    (req.dbUnavailable || /MongooseServerSelectionError|MongoNetworkError|before initial connection/.test(`${err.name} ${err.message}`))
  ) {
    status = 503;
    message = "Service temporarily unavailable";
  }

  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err.stack || err.message);
    if (isProd && status === 500) message = "Internal server error";
  }
  if (res.headersSent) return;
  res.status(status).json({ success: false, message, ...extra });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason?.message || reason);
});

// Local / long-running mode only. On Vercel the exported app is used as the handler.
if (require.main === module) {
  connectDB()
    .catch((err) => console.error("Initial DB connection failed (will retry per request):", err.message))
    .finally(() => {
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || "development"})`);
      });
    });
}

module.exports = app;
