"use strict";

const express = require("express");
const router = express.Router();
const { promisePool } = require("../db");
const { hashPassword, verifyPassword, needsRehash, validatePasswordStrength } = require("../lib/passwords");
const { signToken, AUDIENCES } = require("../lib/tokens");
const { authenticateStaff, requireAdmin } = require("../middleware/staffAuth");
const { loginLimiter, loginSweepLimiter } = require("../middleware/rateLimiters");

const VALID_ROLES = ["sub"];
const VALID_LOGIN_ROLES = ["admin", "sub"];

const publicUser = (row) => ({
  id: row.id,
  name: row.username,
  username: row.username,
  role: row.role,
  canViewInventoryLogs: Boolean(row.can_view_inventory_logs),
});

const issueSession = (row) => ({
  token: signToken({ sub: String(row.id), role: row.role }, AUDIENCES.POS),
  user: publicUser(row),
});

/**
 * First-run bootstrap: creates the very first admin account.
 *
 * Previously this endpoint was open to the internet and accepted any role,
 * which meant anyone who found the URL could register themselves as an
 * administrator. It now only works while the admins table is empty. Every
 * later account is created by an existing admin through POST /admin/staff.
 */
router.post("/register", loginLimiter, async (req, res) => {
  try {
    // mysql2 resolves to [rows, fields]. The extra destructure layer matters:
    // reading `count` off the rows array yields undefined, Number(undefined) is
    // NaN, and `NaN > 0` is false, which would leave this route wide open.
    const [[{ count }]] = await promisePool.query("SELECT COUNT(*) AS count FROM admins");
    if (Number(count) > 0) {
      return res.status(403).json({
        success: false,
        message: "Administrator already exists. Sign in as an admin and create accounts in Manage Staff.",
      });
    }

    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const { password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required" });
    }

    const strengthError = validatePasswordStrength(password);
    if (strengthError) {
      return res.status(400).json({ success: false, message: strengthError });
    }

    const [result] = await promisePool.query(
      "INSERT INTO admins (username, password, role, can_view_inventory_logs) VALUES (?, ?, 'admin', 1)",
      [username, hashPassword(password)]
    );

    const [rows] = await promisePool.query("SELECT * FROM admins WHERE id = ?", [result.insertId]);
    console.log(`✅ Bootstrap admin created: ${username}`);

    return res.status(201).json({ success: true, message: "Administrator created", ...issueSession(rows[0]) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Username already exists" });
    }
    console.error("Bootstrap register error:", error);
    return res.status(500).json({ success: false, message: "Database error" });
  }
});

// Two limiters: a per-account budget, plus a broader per-IP sweep cap so that
// guessing many different usernames from one machine is still throttled.
router.post("/login", loginSweepLimiter, loginLimiter, async (req, res) => {
  try {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const { password } = req.body || {};
    const requestedRole = req.body?.role;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required" });
    }
    if (requestedRole != null && !VALID_LOGIN_ROLES.includes(requestedRole)) {
      return res.status(400).json({ success: false, message: "Invalid account type" });
    }

    const [rows] = await promisePool.query(
      "SELECT id, username, password, role, can_view_inventory_logs FROM admins WHERE username = ?",
      [username]
    );

    // Same response for unknown user and wrong password so the endpoint cannot
    // be used to enumerate valid usernames.
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const user = rows[0];
    if (!verifyPassword(password, user.password)) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    if (requestedRole && user.role !== requestedRole) {
      return res.status(403).json({ success: false, message: "This account does not match the selected account type" });
    }

    // Opportunistically upgrade accounts still on legacy hash parameters.
    if (needsRehash(user.password)) {
      await promisePool
        .query("UPDATE admins SET password = ? WHERE id = ?", [hashPassword(password), user.id])
        .catch((err) => console.warn("Password rehash failed:", err.message));
    }

    return res.json({ success: true, ...issueSession(user) });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
});

/** Returns the account behind the current token. */
router.get("/me", authenticateStaff, (req, res) => {
  res.json({ success: true, user: req.staff });
});

// ==================== STAFF MANAGEMENT (admin only) ====================

router.get("/admin/staff", authenticateStaff, requireAdmin, async (req, res) => {
  try {
    const [results] = await promisePool.query(
      "SELECT id, username, role, can_view_inventory_logs FROM admins ORDER BY username"
    );
    res.json({
      success: true,
      staff: results.map((row) => ({
        id: row.id,
        username: row.username,
        role: row.role,
        canViewInventoryLogs: Boolean(row.can_view_inventory_logs),
      })),
    });
  } catch (error) {
    console.error("Error fetching staff users:", error);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

router.post("/admin/staff", authenticateStaff, requireAdmin, async (req, res) => {
  try {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const { password, canViewInventoryLogs, role: clientRole } = req.body || {};
    const role = "sub";

    if (clientRole && clientRole !== "sub") {
      return res.status(400).json({ success: false, message: "Only sub-admin accounts may be created here" });
    }

    if (!username || !password || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "Only sub-admin accounts may be created here" });
    }

    const strengthError = validatePasswordStrength(password);
    if (strengthError) {
      return res.status(400).json({ success: false, message: strengthError });
    }

    if (req.staff.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const canView = Boolean(canViewInventoryLogs) ? 1 : 0;

    const [result] = await promisePool.query(
      "INSERT INTO admins (username, password, role, can_view_inventory_logs) VALUES (?, ?, ?, ?)",
      [username, hashPassword(password), role, canView]
    );

    res.status(201).json({
      success: true,
      message: "Sub-admin account created",
      staff: { id: result.insertId, username, role, canViewInventoryLogs: Boolean(canView) },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Username already exists" });
    }
    console.error("Error creating staff user:", error);
    return res.status(500).json({ success: false, message: "Database error" });
  }
});

router.put("/admin/staff/:id/access", authenticateStaff, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const allow = req.body?.allow ? 1 : 0;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Invalid staff id" });
    }

    const [result] = await promisePool.query(
      "UPDATE admins SET can_view_inventory_logs = ? WHERE id = ? AND role = 'sub'",
      [allow, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Staff user not found" });
    }

    res.json({ success: true, message: "Access updated", allow: Boolean(allow) });
  } catch (error) {
    console.error("Error updating staff access:", error);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

router.delete("/admin/staff/:id", authenticateStaff, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Invalid staff id" });
    }

    if (id === req.staff.id) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account" });
    }

    const [result] = await promisePool.query("DELETE FROM admins WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Staff user not found" });
    }

    res.json({ success: true, message: "Account deleted" });
  } catch (error) {
    console.error("Error deleting staff user:", error);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

/** Issues a fresh short-lived token for the caller's own session. */
router.post("/refresh", authenticateStaff, async (req, res) => {
  res.json({ success: true, token: signToken({ sub: String(req.staff.id), role: req.staff.role }, AUDIENCES.POS) });
});

module.exports = router;
