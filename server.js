const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./config/db");

const app = express();

/* -------------------- CORS -------------------- */
app.use(
  cors({
    origin: [
      "https://chow-front.vercel.app",
      "http://localhost:3000",
      "http://localhost:5173",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Preflight
app.options("*", cors());

app.use(express.json());

// Ignore favicon
app.get("/favicon.ico", (req, res) => res.status(204).end());

/* -------------------- ROUTES -------------------- */
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/subcategories", require("./routes/subcategoryRoutes"));
app.use("/api/items", require("./routes/itemRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/search", require("./routes/searchRoutes"));
app.use("/api/tickets", require("./routes/tickets"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api", require("./routes/distanceRoutes"));
app.use("/api/payment", require("./routes/paymentRoutes"));
app.use("/api/sweet-deals", require("./routes/sweetDealRoutes"));

/* -------------------- HEALTH -------------------- */
app.get("/", (req, res) => {
  res.json({ message: "Chowdhry Backend API running" });
});

/* -------------------- ERROR HANDLER -------------------- */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message });
});

/* -------------------- START SERVER -------------------- */
const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err);
    process.exit(1);
  });
