"use strict";

const express = require("express");
const router = express.Router();
const { promisePool } = require("../db");
const { authenticateStaff } = require("../middleware/staffAuth");
const { handle } = require("../lib/asyncHandler");

// Categories back the product form, which both admins and staff can reach.
router.use(authenticateStaff);

router.get("/", handle(async (req, res) => {
  const [categories] = await promisePool.query("SELECT * FROM categories ORDER BY name ASC");
  res.json({ success: true, categories });
}));

router.post("/", handle(async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ success: false, message: "Category name required" });

  const [result] = await promisePool.query("INSERT INTO categories (name) VALUES (?)", [name]);
  res.json({ success: true, category: { id: result.insertId, name } });
}));

router.delete("/:id", handle(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "Invalid category id" });
  }

  // Products reference the category by name, so refuse rather than orphan them.
  const [[{ inUse }]] = await promisePool.query(
    "SELECT COUNT(*) AS inUse FROM products WHERE category = (SELECT name FROM categories WHERE id = ?) AND deleted = 0",
    [id]
  );
  if (Number(inUse) > 0) {
    return res.status(409).json({
      success: false,
      message: `Cannot delete: ${inUse} product(s) still use this category. Reassign them first.`,
    });
  }

  const [result] = await promisePool.query("DELETE FROM categories WHERE id = ?", [id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: "Category not found" });
  }

  res.json({ success: true, message: "Category deleted" });
}));

module.exports = router;
