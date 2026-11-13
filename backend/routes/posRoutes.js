"use strict";

const express = require("express");
const router = express.Router();
const { promisePool } = require("../db");
const { authenticateStaff, requireAdmin, requireInventoryLogAccess } = require("../middleware/staffAuth");
const { handle } = require("../lib/asyncHandler");

/**
 * Point-of-sale reads that are not part of the product or order resources:
 * the sales ledger, the inventory ledger, and the monthly rollup.
 *
 * All three require a valid staff token. Authorization is decided from the
 * account row in the database, not from a request header, so a forged
 * `x-user-role: admin` no longer grants access.
 */
router.use(authenticateStaff);

/** Flat sales ledger. */
router.get("/sales", requireAdmin, handle(async (req, res) => {
  const [sales] = await promisePool.query("SELECT * FROM sales ORDER BY created_at DESC");
  res.json({ success: true, sales });
}));

/** Inventory ledger. Visible to admins and to staff granted the permission. */
router.get("/inventory-logs", requireInventoryLogAccess, handle(async (req, res) => {
  const [logs] = await promisePool.query("SELECT * FROM inventory_logs ORDER BY created_at DESC");
  res.json({ success: true, logs });
}));

/** Monthly revenue rollup, admin only. */
router.get("/sales/monthly-report", requireAdmin, handle(async (req, res) => {
  const [reports] = await promisePool.query(`
    SELECT
      DATE_FORMAT(created_at, '%Y-%m') AS month,
      COUNT(DISTINCT receipt_id) AS item_count,
      SUM(quantity) AS total_items,
      SUM(total) AS total_revenue
    FROM sales_items
    GROUP BY DATE_FORMAT(created_at, '%Y-%m')
    ORDER BY month DESC
  `);

  res.json({ success: true, reports });
}));

module.exports = router;
