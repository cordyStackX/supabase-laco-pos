"use strict";

const { promisePool } = require("../db");
const { verifyToken, bearerToken, AUDIENCES } = require("../lib/tokens");

/**
 * Authenticates a POS staff member from the Authorization header.
 *
 * The role is read from the database on every request, never from the token
 * body, so a role change (or a deleted account) takes effect immediately
 * instead of at token expiry.
 */
async function authenticateStaff(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const payload = verifyToken(token, AUDIENCES.POS);
    if (!payload) {
      return res.status(401).json({ success: false, message: "Invalid or expired session" });
    }

    const [rows] = await promisePool.query(
      "SELECT id, username, role, can_view_inventory_logs FROM admins WHERE id = ?",
      [payload.sub]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Account no longer exists" });
    }

    const row = rows[0];
    req.staff = {
      id: row.id,
      username: row.username,
      role: row.role,
      canViewInventoryLogs: Boolean(row.can_view_inventory_logs),
    };

    return next();
  } catch (error) {
    console.error("authenticateStaff error:", error);
    return res.status(500).json({ success: false, message: "Authentication error" });
  }
}

/** Restrict a route to the listed POS roles. Must run after authenticateStaff. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.staff) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  if (!roles.includes(req.staff.role)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  return next();
};

/**
 * Inventory logs are visible to admins, and to staff explicitly granted the
 * per-account permission by an admin.
 */
const requireInventoryLogAccess = (req, res, next) => {
  if (!req.staff) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  if (req.staff.role !== "admin" && !req.staff.canViewInventoryLogs) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  return next();
};

const requireAdmin = requireRole("admin");

module.exports = { authenticateStaff, requireRole, requireAdmin, requireInventoryLogAccess };
