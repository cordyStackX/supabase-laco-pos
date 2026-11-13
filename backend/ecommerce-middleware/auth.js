"use strict";

const { promisePool } = require("../db");
const { verifyToken, bearerToken, AUDIENCES } = require("../lib/tokens");

/**
 * Loads the customer behind the bearer token into req.user.
 *
 * A token issued for the POS panel is rejected here: the audience claim is
 * checked, so a staff token can never be replayed against a customer route.
 */
const loadCustomer = async (req) => {
  const token = bearerToken(req);
  if (!token) return null;

  const payload = verifyToken(token, AUDIENCES.ECOM);
  if (!payload) return null;

  const [rows] = await promisePool.query(
    "SELECT id, full_name, email, contact_number, role FROM customers WHERE id = ?",
    [payload.sub]
  );
  if (rows.length === 0) return null;

  return {
    id: rows[0].id,
    fullName: rows[0].full_name,
    email: rows[0].email,
    contactNumber: rows[0].contact_number,
    role: rows[0].role,
  };
};

const authenticateToken = async (req, res, next) => {
  try {
    const user = await loadCustomer(req);
    if (!user) {
      return res.status(401).json({ message: "Invalid or expired session" });
    }
    req.user = user;
    return next();
  } catch (error) {
    console.error("authenticateToken error:", error);
    return res.status(500).json({ message: "Authentication error" });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    req.user = await loadCustomer(req);
  } catch (error) {
    console.error("optionalAuth error:", error);
  }
  return next();
};

const requireCustomer = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Authentication required" });
  if (req.user.role !== "customer") {
    return res.status(403).json({ message: "Customer access required" });
  }
  return next();
};

/**
 * E-commerce admin actions. Accepts the `admin` and `staff` roles that exist
 * in the customers table, and a staff account that has been marked as POS
 * staff, so one login can drive both panels.
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Authentication required" });
  if (req.user.role !== "admin" && req.user.role !== "staff") {
    return res.status(403).json({ message: "Admin or staff access required" });
  }
  return next();
};

/**
 * Guard for the /api/admin surface, which is driven from the POS panel.
 *
 * Accepts either a POS staff token (account in `admins`, admin role only) or
 * an e-commerce token whose customer record carries the admin or staff role.
 * This is what lets one signed-in administrator use both interfaces instead of
 * needing a second account in a second table.
 */
const authenticateEcomAdmin = async (req, res, next) => {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const posPayload = verifyToken(token, AUDIENCES.POS);
    if (posPayload) {
      const [rows] = await promisePool.query("SELECT id, username, role FROM admins WHERE id = ?", [
        posPayload.sub,
      ]);
      if (rows.length === 0) return res.status(401).json({ message: "Account no longer exists" });
      if (rows[0].role !== "admin") {
        return res.status(403).json({ message: "Administrator access required" });
      }
      req.user = { id: rows[0].id, fullName: rows[0].username, role: "admin", source: "pos" };
      return next();
    }

    const user = await loadCustomer(req);
    if (!user) return res.status(401).json({ message: "Invalid or expired session" });
    if (user.role !== "admin" && user.role !== "staff") {
      return res.status(403).json({ message: "Admin or staff access required" });
    }
    req.user = { ...user, source: "ecom" };
    return next();
  } catch (error) {
    console.error("authenticateEcomAdmin error:", error);
    return res.status(500).json({ message: "Authentication error" });
  }
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireCustomer,
  requireAdmin,
  authenticateEcomAdmin,
};
