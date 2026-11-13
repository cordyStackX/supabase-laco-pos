"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");

const { promisePool, verifyConnection } = require("./db");
const { getSecret } = require("./lib/tokens");
const { apiLimiter } = require("./middleware/rateLimiters");
const { getProductPublicUrl, isSupabaseStorageEnabled } = require("./lib/objectStorage");

const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const orderRoutes = require("./routes/orderRoutes");
const posRoutes = require("./routes/posRoutes");

const ecomAuthRoutes = require("./ecommerce-routes/auth");
const ecomProductRoutes = require("./ecommerce-routes/customerProducts");
const ecomCartRoutes = require("./ecommerce-routes/customerCart");
const ecomOrderRoutes = require("./ecommerce-routes/customerOrders");
const ecomPaymentRoutes = require("./ecommerce-routes/customerPayments");
const ecomAdminRoutes = require("./ecommerce-routes/admin");
const otpRoutes = require("./ecommerce-routes/otp");

const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 5000;
const { UPLOADS_DIR, RECEIPTS_DIR } = require("./lib/paths");

// Fail fast on a missing or weak signing key. Tokens signed with an
// undefined secret are forgeable, so this must not be a warning.
try {
  getSecret();
} catch (error) {
  console.error(`\n[FAIL] ${error.message}\n`);
  process.exit(1);
}

const app = express();

// Behind a reverse proxy, so rate limiting and req.ip see the real client.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);
app.disable("x-powered-by");

// -------------------------
// Security headers
// -------------------------
app.use(
  helmet({
    // Product images and payment receipts are served to the two frontends,
    // which run on different origins from the API in development.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: isProduction ? undefined : false,
  })
);

// -------------------------
// CORS
// -------------------------
// Explicit allowlist. The previous cors() call reflected any origin, which
// let any website on the internet call this API from a visitor's browser.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests, curl and native apps send no Origin header.
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// -------------------------
// Parsers and static files
// -------------------------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

if (!isSupabaseStorageEnabled()) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

// Payment receipts live inside the uploads tree, but they are customer payment
// proof and must never be world-readable. Block the subtree before the static
// handler can serve it; staff fetch receipts through the authenticated route in
// orderRoutes (/api/orders/receipts/:filename).
app.use("/uploads", (req, res, next) => {
  if (/^\/?receipts(\/|$)/i.test(req.url)) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
});

if (isSupabaseStorageEnabled()) {
  app.get("/uploads/:filename", (req, res, next) => {
    if (!/^[A-Za-z0-9._-]+$/.test(req.params.filename) || req.params.filename === "." || req.params.filename === "..") {
      return res.status(400).json({ error: "Invalid image filename" });
    }
    try {
      return res.redirect(302, getProductPublicUrl(req.params.filename));
    } catch (error) {
      return next(error);
    }
  });
} else {
  app.use(
    "/uploads",
    express.static(UPLOADS_DIR, {
      maxAge: isProduction ? "7d" : 0,
      index: false,
      dotfiles: "deny",
    })
  );
}

// -------------------------
// Routes
// -------------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "LCCB Bookstore API is running" });
});

app.use("/api", apiLimiter);

app.use("/api", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);

// E-commerce
app.use("/api/auth", ecomAuthRoutes);
app.use("/api/customer/products", ecomProductRoutes);
app.use("/api/customer/cart", ecomCartRoutes);
app.use("/api/customer/orders", ecomOrderRoutes);
app.use("/api/customer/orders", ecomPaymentRoutes);
app.use("/api/admin", ecomAdminRoutes);
app.use("/api/otp", otpRoutes);

app.use("/api", posRoutes);

app.get("/", (req, res) => res.send("POS Backend Running"));

// -------------------------
// Errors
// -------------------------
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ success: false, message: "API endpoint not found" });
  }
  return res.status(404).send("Not found");
});

// Central error handler. Logs the detail, returns something safe to the client.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.message && error.message.includes("is not allowed")) {
    return res.status(403).json({ success: false, message: "Origin not allowed" });
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, error);
  return res.status(500).json({ success: false, message: "Internal server error" });
});

// -------------------------
// Start
// -------------------------
// Verify the database before accepting traffic, so a misconfigured deployment
// fails immediately and loudly instead of serving 500s on the first request.
const start = async () => {
  const reachable = await verifyConnection({ exitOnFailure: isProduction });
  if (!reachable && isProduction) return; // verifyConnection already exited

  const server = app.listen(PORT, () => {
    console.log(`[OK] Server running on http://localhost:${PORT} (${isProduction ? "production" : "development"})`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `[FAIL] Port ${PORT} is already in use. A second backend is probably still running - ` +
          "only one instance may serve this port."
      );
    } else {
      console.error("[FAIL] Server error:", error);
    }
    process.exit(1);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} received, shutting down...`);
    server.close(() => {
      promisePool
        .end()
        .catch(() => {})
        .then(() => process.exit(0));
    });
    // Do not hang forever on lingering keep-alive sockets.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

start().catch((error) => {
  console.error("[FAIL] Failed to start server:", error.message);
  process.exit(1);
});

module.exports = app;
