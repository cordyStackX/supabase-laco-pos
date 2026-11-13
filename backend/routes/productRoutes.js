"use strict";

const express = require("express");
const router = express.Router();
const multer = require("multer");

const { promisePool } = require("../db");
const { authenticateStaff, requireAdmin } = require("../middleware/staffAuth");
const { uploadLimiter } = require("../middleware/rateLimiters");
const { handle } = require("../lib/asyncHandler");
const { runCheckout, runRestock } = require("../lib/operations");

const { UPLOADS_DIR } = require("../lib/paths");
const { createImageUpload, discardTemporaryUpload, removeUpload, saveUpload } = require("../lib/objectStorage");

const upload = createImageUpload({ multer, destination: UPLOADS_DIR });

// Every route below requires a valid staff token. Public access ends here.
router.use(authenticateStaff);

// -------------------------
// GET all products
// -------------------------
router.get("/", handle(async (req, res) => {
  const [results] = await promisePool.query("SELECT * FROM products WHERE deleted = 0 ORDER BY name ASC");

  const products = results.map((p) => ({
    ...p,
    barcode: String(p.barcode),
    size: p.size || null,
  }));

  res.json({ success: true, products });
}));

// -------------------------
// GET product by barcode
// -------------------------
router.get("/barcode/:barcode", handle(async (req, res) => {
  const [results] = await promisePool.query("SELECT * FROM products WHERE barcode = ? AND deleted = 0 LIMIT 1", [
    req.params.barcode,
  ]);

  if (results.length === 0) {
    return res.json({ success: false, message: "Product not found" });
  }

  const product = results[0];
  res.json({
    success: true,
    product: { ...product, barcode: String(product.barcode), size: product.size || null },
  });
}));

// -------------------------
// CHECKOUT  (staff and admin)
// -------------------------
router.post("/checkout", handle(async (req, res) => {
  const { items, customerName, checkoutDepartment } = req.body || {};

  const result = await runCheckout(promisePool, {
    items,
    customerName,
    checkoutDepartment,
    staffId: req.staff.id,
  });

  res.json({ success: true, message: "Payment successful", receiptId: result.receiptId, total: result.total });
}));

// -------------------------
// RESTOCK  (admin only)
// -------------------------
router.post("/restock", requireAdmin, handle(async (req, res) => {
  const { productId, amount, supplier, costPrice, notes } = req.body || {};

  const result = await runRestock(promisePool, {
    productId,
    amount,
    supplier,
    costPrice,
    notes,
    staffName: req.staff.username,
  });

  res.json({
    success: true,
    message: "Restock successful",
    newStock: result.newStock,
    previousStock: result.previousStock,
    restockId: result.restockId,
  });
}));

// -------------------------
// ADD new product
// -------------------------
router.post("/", uploadLimiter, upload.single("image"), handle(async (req, res) => {
  const name = req.body?.name?.trim();
  const category = req.body?.category?.trim();
  const barcode = req.body?.barcode?.toString().trim();
  const size = req.body?.size?.trim() ? req.body.size.trim() : null;
  const department = req.body?.department || "";
  const price = Number(req.body?.price);
  const stock = Number(req.body?.stock ?? 0);

  if (!name || !price || !category || !barcode) {
    await discardTemporaryUpload(req.file);
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }
  if (!Number.isFinite(price) || price < 0) {
    await discardTemporaryUpload(req.file);
    return res.status(400).json({ success: false, message: "Price must be a positive number" });
  }
  if (!Number.isInteger(stock) || stock < 0) {
    await discardTemporaryUpload(req.file);
    return res.status(400).json({ success: false, message: "Stock must be zero or a positive whole number" });
  }

  const stored = req.file ? await saveUpload(req.file, { kind: "product" }) : null;
  const image = stored?.relativePath || "";

  try {
    const [result] = await promisePool.query(
      `INSERT INTO products (name, price, category, barcode, stock, image, size, department)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, price, category, barcode, stock, image, size, department]
    );

    res.json({ success: true, id: result.insertId, message: "Product added successfully" });
  } catch (error) {
    if (image) await removeUpload(image, "product");
    else await discardTemporaryUpload(req.file);
    throw error;
  }
}));

// -------------------------
// UPDATE product
// -------------------------
router.put("/:id", uploadLimiter, upload.single("image"), handle(async (req, res) => {
  const id = Number(req.params.id);
  const name = req.body?.name?.trim();
  const category = req.body?.category?.trim();
  const barcode = req.body?.barcode?.toString().trim();
  const size = req.body?.size?.trim() ? req.body.size.trim() : null;
  const department = req.body?.department || "";
  const price = Number(req.body?.price);
  const stock = Number(req.body?.stock ?? 0);

  if (!name || !price || !category || !barcode) {
    await discardTemporaryUpload(req.file);
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }
  if (!Number.isFinite(price) || price < 0) {
    await discardTemporaryUpload(req.file);
    return res.status(400).json({ success: false, message: "Price must be a positive number" });
  }
  if (!Number.isInteger(stock) || stock < 0) {
    await discardTemporaryUpload(req.file);
    return res.status(400).json({ success: false, message: "Stock must be zero or a positive whole number" });
  }

  const [rows] = await promisePool.query("SELECT image FROM products WHERE id = ?", [id]);
  if (rows.length === 0) {
    await discardTemporaryUpload(req.file);
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  const stored = req.file ? await saveUpload(req.file, { kind: "product" }) : null;
  const newImage = stored?.relativePath || null;
  const oldImage = rows[0].image;

  const sql = `UPDATE products SET name = ?, price = ?, category = ?, barcode = ?, stock = ?, size = ?, department = ?
               ${newImage ? ", image = ?" : ""} WHERE id = ?`;
  const params = [name, price, category, barcode, stock, size, department];
  if (newImage) params.push(newImage);
  params.push(id);

  try {
    await promisePool.query(sql, params);
  } catch (error) {
    if (newImage) await removeUpload(newImage, "product");
    throw error;
  }

  if (newImage && oldImage && oldImage !== newImage) await removeUpload(oldImage, "product");

  res.json({ success: true, message: "Product updated successfully" });
}));

router.put("/:id/update-category", handle(async (req, res) => {
  const { category } = req.body || {};
  if (!category) return res.status(400).json({ success: false, message: "Category is required" });

  const [result] = await promisePool.query("UPDATE products SET category = ? WHERE id = ?", [
    category,
    Number(req.params.id),
  ]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }
  res.json({ success: true, message: "Category updated" });
}));

// -------------------------
// ADD stock (admin only)
// -------------------------
router.put("/:id/add-stock", requireAdmin, handle(async (req, res) => {
  const stockAmount = Number.parseInt(req.body?.amount, 10);
  if (!Number.isInteger(stockAmount) || stockAmount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid stock amount" });
  }

  const [result] = await promisePool.query("UPDATE products SET stock = stock + ? WHERE id = ? AND deleted = 0", [
    stockAmount,
    Number(req.params.id),
  ]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  res.json({ success: true, message: "Stock added" });
}));

router.put("/:id/update-image", uploadLimiter, upload.single("image"), handle(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No image uploaded" });

  const [rows] = await promisePool.query("SELECT image FROM products WHERE id = ?", [Number(req.params.id)]);
  if (rows.length === 0) {
    await discardTemporaryUpload(req.file);
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  const stored = await saveUpload(req.file, { kind: "product" });
  const newPath = stored.relativePath;
  try {
    await promisePool.query("UPDATE products SET image = ? WHERE id = ?", [newPath, Number(req.params.id)]);
  } catch (error) {
    await removeUpload(newPath, "product");
    throw error;
  }
  if (rows[0].image && rows[0].image !== newPath) await removeUpload(rows[0].image, "product");

  res.json({ success: true, message: "Image updated", newImage: newPath });
}));

router.put("/:id/remove-image", handle(async (req, res) => {
  const [rows] = await promisePool.query("SELECT image FROM products WHERE id = ?", [Number(req.params.id)]);
  if (rows.length === 0) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  await promisePool.query("UPDATE products SET image = '' WHERE id = ?", [Number(req.params.id)]);
  await removeUpload(rows[0].image, "product");

  res.json({ success: true, message: "Image removed" });
}));

// -------------------------
// DELETE product (admin only)
// -------------------------
// Always a soft delete. sales_items, order_items and inventory_logs reference
// products, so a hard delete would either fail or silently rewrite history.
router.delete("/:id", requireAdmin, handle(async (req, res) => {
  const [rows] = await promisePool.query("SELECT image FROM products WHERE id = ?", [Number(req.params.id)]);
  if (rows.length === 0) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  await promisePool.query("UPDATE products SET deleted = 1 WHERE id = ?", [Number(req.params.id)]);
  await removeUpload(rows[0].image, "product");

  res.json({ success: true, message: "Product deleted successfully" });
}));

// -------------------------
// GET sales (admin only)
// -------------------------
router.get("/sales", requireAdmin, handle(async (req, res) => {
  const [results] = await promisePool.query(`
    SELECT
      si.id, si.receipt_id, si.product_id, si.product_name, si.barcode,
      si.quantity, si.price, si.total, si.created_at,
      s.total as receipt_total,
      s.customer_name,
      s.customer_type as customer_type,
      s.checkout_department as checkout_department,
      p.category as category,
      p.department as department,
      p.deleted as product_deleted
    FROM sales_items si
    LEFT JOIN sales s ON si.receipt_id = s.receipt_id
    LEFT JOIN products p ON si.product_id = p.id
    ORDER BY si.created_at DESC
  `);

  res.json({ success: true, sales: results });
}));

// -------------------------
// GET restock logs (admin only)
// -------------------------
router.get("/restocks", requireAdmin, handle(async (req, res) => {
  const [results] = await promisePool.query(`
    SELECT r.*, p.name as product_name
    FROM restocks r
    LEFT JOIN products p ON r.product_id = p.id
    ORDER BY r.created_at DESC
  `);

  res.json({ success: true, restocks: results });
}));

// -------------------------
// GET distinct suppliers used in past restocks (admin only)
// -------------------------
// Supplier is free text on restocks, so this is derived rather than a real
// suppliers table. Grouping on TRIM() collapses padding and the case-insensitive
// collation collapses "Acme"/"acme" so the picker cannot re-introduce dupes.
router.get("/suppliers", requireAdmin, handle(async (req, res) => {
  const [results] = await promisePool.query(`
    SELECT TRIM(supplier) AS supplier,
           COUNT(*) AS times_used,
           MAX(created_at) AS last_used
    FROM restocks
    WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''
    GROUP BY TRIM(supplier)
    ORDER BY last_used DESC, times_used DESC
  `);

  res.json({ success: true, suppliers: results });
}));

module.exports = router;
