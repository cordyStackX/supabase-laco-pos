"use strict";

const express = require("express");
const router = express.Router();
const multer = require("multer");

const { promisePool } = require("../db");
const { authenticateStaff, requireAdmin } = require("../middleware/staffAuth");
const { uploadLimiter } = require("../middleware/rateLimiters");
const { handle } = require("../lib/asyncHandler");
const { applyOrderStockOut, verifyEcomPayment, withTransaction } = require("../lib/operations");

const { RECEIPTS_DIR } = require("../lib/paths");
const {
  createImageUpload,
  discardTemporaryUpload,
  readReceipt,
  removeUpload,
  saveUpload,
} = require("../lib/objectStorage");
const upload = createImageUpload({ multer, destination: RECEIPTS_DIR, prefix: "receipt-" });

// Maps ecom_orders.status (human readable) <-> online_orders.order_status (enum).
// The two tables are separate schemas; this is the contract between them.
const ECOM_TO_POS_STATUS = {
  "Pending Payment Verification": "pending_payment",
  "Payment Verified": "verified",
  Preparing: "preparing",
  "Ready for Pickup": "ready_for_pickup",
  Completed: "completed",
  Rejected: "rejected",
  Cancelled: "cancelled",
};
const POS_TO_ECOM_STATUS = {
  pending_payment: "Pending Payment Verification",
  verified: "Payment Verified",
  preparing: "Preparing",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
const VALID_POS_STATUSES = Object.keys(POS_TO_ECOM_STATUS);

const POS_PAYMENT_STATUS = {
  pending_payment: "pending",
  verified: "verified",
  preparing: "verified",
  ready_for_pickup: "verified",
  completed: "verified",
  rejected: "rejected",
  cancelled: "rejected",
};

const generateOrderNumber = () => {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  // Random suffix keeps the public order number unguessable; the UNIQUE index
  // is the real guarantee, a collision is retried by the caller.
  return `ORD-${stamp}-${crypto.randomInt(1000, 9999)}`;
};

const formatEcomOrder = (o) => {
  const date = new Date(o.created_at);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");

  return {
    id: o.id,
    source: "ecom",
    order_number: `ECO-${stamp}-${String(o.id).padStart(4, "0")}`,
    customer_id: o.customer_id,
    customer_name: o.customer_full_name || "",
    customer_email: o.customer_email || "",
    customer_contact: o.customer_contact || "",
    total_amount: o.total_amount,
    payment_method: String(o.payment_method || "gcash").toLowerCase().includes("rcbc") ? "rcbc" : "gcash",
    reference_number: o.reference_number || null,
    receipt_image: o.receipt_image || null,
    payment_status: o.payment_status || "pending",
    order_status: ECOM_TO_POS_STATUS[o.status] || o.status,
    verified_at: o.verified_at || null,
    pickup_code: o.pickup_code || null,
    created_at: o.created_at,
  };
};

const loadEcomOrdersWithNames = async () => {
  const [ecomRows] = await promisePool.query("SELECT * FROM ecom_orders");
  const ecomOrders = ecomRows.map(formatEcomOrder);
  if (ecomOrders.length === 0) return ecomOrders;

  const placeholders = ecomOrders.map(() => "?").join(",");
  const [nameRows] = await promisePool.query(
    `SELECT order_id, GROUP_CONCAT(product_name SEPARATOR ', ') AS product_names
     FROM ecom_order_items WHERE order_id IN (${placeholders}) GROUP BY order_id`,
    ecomOrders.map((o) => o.id)
  );

  const nameMap = new Map(nameRows.map((r) => [r.order_id, r.product_names]));
  ecomOrders.forEach((o) => {
    o.product_names = nameMap.get(o.id) || "";
  });

  return ecomOrders;
};

const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);

// Everything below is staff-only; most of it is admin-only.
router.use(authenticateStaff);
router.use(requireAdmin);

// ==================== CUSTOMERS ====================

router.get("/customers", handle(async (req, res) => {
  const [results] = await promisePool.query(`
    SELECT c.*,
      COALESCE(NULLIF(c.contact, ''), c.contact_number) AS contact,
      (SELECT COUNT(*) FROM online_orders WHERE customer_id = c.id AND order_status != 'rejected') +
      (SELECT COUNT(*) FROM ecom_orders WHERE customer_id = c.id AND status != 'Rejected') AS total_orders,
      COALESCE((SELECT SUM(total_amount) FROM online_orders WHERE customer_id = c.id AND order_status != 'rejected'), 0) +
      COALESCE((SELECT SUM(total_amount) FROM ecom_orders WHERE customer_id = c.id AND status != 'Rejected'), 0) AS total_purchases
    FROM customers c
    ORDER BY c.created_at DESC
  `);
  res.json({ success: true, customers: results });
}));

router.get("/customers/:id", handle(async (req, res) => {
  const [results] = await promisePool.query(
    `SELECT c.*,
      COALESCE(NULLIF(c.contact, ''), c.contact_number) AS contact,
      (SELECT COUNT(*) FROM online_orders WHERE customer_id = c.id AND order_status != 'rejected') +
      (SELECT COUNT(*) FROM ecom_orders WHERE customer_id = c.id AND status != 'Rejected') AS total_orders,
      COALESCE((SELECT SUM(total_amount) FROM online_orders WHERE customer_id = c.id AND order_status != 'rejected'), 0) +
      COALESCE((SELECT SUM(total_amount) FROM ecom_orders WHERE customer_id = c.id AND status != 'Rejected'), 0) AS total_purchases
     FROM customers c WHERE c.id = ?`,
    [req.params.id]
  );
  if (!results.length) return res.status(404).json({ success: false, message: "Customer not found" });
  res.json({ success: true, customer: results[0] });
}));

router.get("/customers/:id/orders", handle(async (req, res) => {
  const [posRows] = await promisePool.query(
    `SELECT o.*, c.name AS customer_name, c.email AS customer_email, c.contact AS customer_contact
     FROM online_orders o JOIN customers c ON o.customer_id = c.id
     WHERE o.customer_id = ? ORDER BY o.created_at DESC`,
    [req.params.id]
  );
  const [ecomRows] = await promisePool.query("SELECT * FROM ecom_orders WHERE customer_id = ?", [req.params.id]);

  const orders = [
    ...posRows.map((o) => ({ ...o, source: "pos" })),
    ...ecomRows.map(formatEcomOrder),
  ].sort(byNewest);

  res.json({ success: true, orders });
}));

// ==================== ORDERS ====================

router.get("/orders", handle(async (req, res) => {
  const [posRows] = await promisePool.query(`
    SELECT o.*,
      c.name AS customer_name, c.email AS customer_email, c.contact AS customer_contact,
      (SELECT GROUP_CONCAT(oi.product_name SEPARATOR ', ') FROM order_items oi WHERE oi.order_id = o.id) AS product_names
    FROM online_orders o
    JOIN customers c ON o.customer_id = c.id
    ORDER BY o.created_at DESC
  `);

  const orders = [...posRows.map((o) => ({ ...o, source: "pos" })), ...(await loadEcomOrdersWithNames())].sort(byNewest);
  res.json({ success: true, orders });
}));

router.get("/orders/:id", handle(async (req, res) => {
  const source = req.query.source || "pos";

  if (source === "ecom") {
    const [orders] = await promisePool.query("SELECT * FROM ecom_orders WHERE id = ?", [req.params.id]);
    if (!orders.length) return res.status(404).json({ success: false, message: "Order not found" });

    const order = formatEcomOrder(orders[0]);
    const [items] = await promisePool.query("SELECT * FROM ecom_order_items WHERE order_id = ?", [order.id]);
    order.items = items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name,
      barcode: null,
      quantity: item.quantity,
      price: item.price,
      total: Number(item.price) * Number(item.quantity),
    }));

    return res.json({ success: true, order });
  }

  const [orders] = await promisePool.query(
    `SELECT o.*, c.name AS customer_name, c.email AS customer_email, c.contact AS customer_contact
     FROM online_orders o JOIN customers c ON o.customer_id = c.id WHERE o.id = ?`,
    [req.params.id]
  );
  if (!orders.length) return res.status(404).json({ success: false, message: "Order not found" });

  const order = orders[0];
  const [items] = await promisePool.query("SELECT * FROM order_items WHERE order_id = ?", [order.id]);
  order.items = items;

  res.json({ success: true, order });
}));

router.get("/orders/:id/items", handle(async (req, res) => {
  const [items] = await promisePool.query("SELECT * FROM order_items WHERE order_id = ?", [req.params.id]);
  res.json({ success: true, items });
}));

router.post("/orders", handle(async (req, res) => {
  const { customer_id, items, payment_method, reference_number, receipt_image, notes } = req.body || {};

  if (!customer_id || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, message: "Customer and items required" });
  }

  if (payment_method && String(payment_method).trim().toLowerCase() !== "gcash") {
    return res.status(400).json({ success: false, message: "GCash is the only supported online payment method" });
  }

  // Prices come from the catalogue, never from the request body.
  const [products] = await promisePool.query(
    `SELECT id, name, price, barcode FROM products
     WHERE id IN (?) AND deleted = 0`,
    [items.map((item) => Number(item.product_id))]
  );
  const priceById = new Map(products.map((p) => [p.id, p]));

  const lines = [];
  let totalAmount = 0;
  for (const item of items) {
    const product = priceById.get(Number(item.product_id));
    if (!product) {
      return res.status(400).json({ success: false, message: `Product ${item.product_id} not found` });
    }
    const quantity = Number(item.quantity || 1);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, message: `Invalid quantity for ${product.name}` });
    }
    totalAmount += Number(product.price) * quantity;
    lines.push({ product, quantity });
  }

  const { orderId, orderNumber } = await withTransaction(promisePool, async (connection) => {
    let orderNumber = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      orderNumber = generateOrderNumber();
      try {
        const [header] = await connection.query(
          `INSERT INTO online_orders
             (order_number, customer_id, total_amount, payment_method, reference_number, receipt_image, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            orderNumber,
            customer_id,
            totalAmount,
            "gcash",
            reference_number || null,
            receipt_image || null,
            notes || null,
          ]
        );

        const rows = lines.map(({ product, quantity }) => [
          header.insertId,
          product.id,
          product.name,
          product.barcode || null,
          quantity,
          product.price,
          Number(product.price) * quantity,
        ]);

        await connection.query(
          `INSERT INTO order_items (order_id, product_id, product_name, barcode, quantity, price, total)
           VALUES ?`,
          [rows]
        );

        return { orderId: header.insertId, orderNumber };
      } catch (error) {
        // Retry only on a colliding order_number; anything else is a real fault.
        if (error.code !== "ER_DUP_ENTRY" || attempt === 4) throw error;
      }
    }
    throw new Error("Could not allocate an order number");
  });

  res.json({ success: true, orderId, order_number: orderNumber });
}));

router.put("/orders/:id/status", handle(async (req, res) => {
  const { status } = req.body || {};
  const source = req.query.source || "pos";

  if (!VALID_POS_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  if (source === "ecom") {
    return withTransaction(promisePool, async (connection) => {
      const [current] = await connection.query(
        "SELECT id, status FROM ecom_orders WHERE id = ? FOR UPDATE",
        [req.params.id]
      );
      if (current.length === 0) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }

      await connection.query("UPDATE ecom_orders SET status = ? WHERE id = ?", [
        POS_TO_ECOM_STATUS[status],
        req.params.id,
      ]);
    }).then(() => res.json({ success: true, message: "Status updated" }));
  }

  await withTransaction(promisePool, async (connection) => {
    // The row is locked so two concurrent status updates cannot both observe
    // the pre-completed state and both release stock.
    const [current] = await connection.query(
      "SELECT id, order_status FROM online_orders WHERE id = ? FOR UPDATE",
      [req.params.id]
    );
    if (current.length === 0) {
      const error = new Error("Order not found");
      error.status = 404;
      throw error;
    }

    await connection.query("UPDATE online_orders SET order_status = ?, payment_status = ? WHERE id = ?", [
      status,
      POS_PAYMENT_STATUS[status],
      req.params.id,
    ]);

    // Stock leaves the catalogue when the order is fulfilled, not when it is
    // created, so a cancelled or rejected order never consumes inventory.
    // Guarded on the transition so re-saving an already-completed order (or a
    // retried request) cannot deduct the same units twice.
    if (status === "completed" && current[0].order_status !== "completed") {
      const [items] = await connection.query(
        "SELECT product_id, quantity, product_name FROM order_items WHERE order_id = ?",
        [req.params.id]
      );
      await applyOrderStockOut(connection, {
        orderId: req.params.id,
        items,
        reason: `Online Order ${req.params.id}`,
      });
    }
  });

  res.json({ success: true, message: "Status updated" });
}));

router.put("/orders/:id/verify-payment", handle(async (req, res) => {
  const source = req.query.source || "pos";
  // Verified by the authenticated staff member, not by a client-supplied id.
  const verifiedBy = req.staff.id;

  if (source === "ecom") {
    const result = await verifyEcomPayment(promisePool, { orderId: req.params.id, verifiedBy });
    return res.json({ success: true, message: "Payment verified", pickup_code: result.pickupCode });
  }

  await withTransaction(promisePool, async (connection) => {
    const [result] = await connection.query(
      `UPDATE online_orders
       SET payment_status = 'verified', order_status = 'verified', verified_by = ?, verified_at = NOW()
       WHERE id = ?`,
      [verifiedBy, req.params.id]
    );
    if (result.affectedRows === 0) {
      const error = new Error("Order not found");
      error.status = 404;
      throw error;
    }
    await connection.query(
      "UPDATE order_payments SET status = 'verified', verified_by = ?, verified_at = NOW() WHERE order_id = ?",
      [verifiedBy, req.params.id]
    );
  });

  res.json({ success: true, message: "Payment verified" });
}));

router.put("/orders/:id/reject-payment", handle(async (req, res) => {
  const source = req.query.source || "pos";

  if (source === "ecom") {
    await withTransaction(promisePool, async (connection) => {
      const [result] = await connection.query(
        "UPDATE ecom_orders SET payment_status = 'rejected', status = 'Rejected' WHERE id = ?",
        [req.params.id]
      );
      if (result.affectedRows === 0) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      await connection.query("UPDATE ecom_payments SET status = 'rejected' WHERE order_id = ?", [req.params.id]);
    });
    return res.json({ success: true, message: "Payment rejected" });
  }

  await withTransaction(promisePool, async (connection) => {
    const [result] = await connection.query(
      "UPDATE online_orders SET payment_status = 'rejected', order_status = 'rejected' WHERE id = ?",
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      const error = new Error("Order not found");
      error.status = 404;
      throw error;
    }
    await connection.query("UPDATE order_payments SET status = 'rejected' WHERE order_id = ?", [req.params.id]);
  });

  res.json({ success: true, message: "Payment rejected" });
}));

router.post("/orders/:id/upload-receipt", uploadLimiter, upload.single("receipt"), handle(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

  const [orders] = await promisePool.query("SELECT id FROM online_orders WHERE id = ?", [req.params.id]);
  if (orders.length === 0) {
    await discardTemporaryUpload(req.file);
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  const stored = await saveUpload(req.file, { kind: "receipt" });
  const receiptPath = stored.relativePath;
  let result;
  try {
    [result] = await promisePool.query("UPDATE online_orders SET receipt_image = ? WHERE id = ?", [
      receiptPath,
      req.params.id,
    ]);
  } catch (error) {
    await removeUpload(receiptPath, "receipt");
    throw error;
  }
  if (result.affectedRows === 0) {
    await removeUpload(receiptPath, "receipt");
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  await promisePool.query("UPDATE order_payments SET receipt_image = ? WHERE order_id = ?", [
    receiptPath,
    req.params.id,
  ]);

  res.json({ success: true, receipt_path: receiptPath });
}));

// Receipts are blocked from the public /uploads static mount, so staff read them
// through here. This sits after router.use(requireAdmin) on line 133, so it
// already requires a valid admin token.
router.get("/receipts/:filename", handle(async (req, res) => {
  const { filename } = req.params;
  if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename === "." || filename === "..") {
    return res.status(400).json({ success: false, message: "Invalid receipt filename" });
  }

  // Only serve files that are actually referenced by an order, so a stray file
  // dropped in the directory is not readable.
  const storedPath = `/uploads/receipts/${filename}`;
  const [referenced] = await promisePool.query(
    `SELECT id FROM online_orders WHERE receipt_image = ?
     UNION SELECT order_id FROM order_payments WHERE receipt_image = ?
     UNION SELECT id FROM ecom_orders WHERE receipt_image = ?
     UNION SELECT order_id FROM ecom_payments WHERE receipt_image = ?
     LIMIT 1`,
    [storedPath, storedPath, storedPath, storedPath]
  );
  if (referenced.length === 0) {
    return res.status(404).json({ success: false, message: "Receipt not found" });
  }

  const file = await readReceipt(filename);
  res.set("Cache-Control", "private, no-store");
  if (file.buffer) return res.type(file.contentType).send(file.buffer);
  res.sendFile(file.path, { dotfiles: "deny" }, (error) => {
    if (error && !res.headersSent) res.status(404).json({ success: false, message: "Receipt not found" });
  });
}));

// ==================== NOTIFICATIONS ====================

router.get("/notifications", handle(async (req, res) => {
  const [
    [posPending],
    [ecomPending],
    [posPrep],
    [ecomPrep],
    [lowStock],
    [posReady],
    [ecomReady],
  ] = await Promise.all([
    promisePool.query("SELECT COUNT(*) AS count FROM online_orders WHERE order_status = 'pending_payment'"),
    promisePool.query("SELECT COUNT(*) AS count FROM ecom_orders WHERE status = 'Pending Payment Verification'"),
    promisePool.query("SELECT COUNT(*) AS count FROM online_orders WHERE order_status = 'verified' AND payment_status = 'verified'"),
    promisePool.query("SELECT COUNT(*) AS count FROM ecom_orders WHERE status = 'Payment Verified'"),
    promisePool.query("SELECT COUNT(*) AS count FROM products WHERE deleted = 0 AND stock <= 30 AND stock > 0"),
    promisePool.query("SELECT COUNT(*) AS count FROM online_orders WHERE order_status = 'ready_for_pickup'"),
    promisePool.query("SELECT COUNT(*) AS count FROM ecom_orders WHERE status = 'Ready for Pickup'"),
  ]);

  res.json({
    success: true,
    notifications: [
      { type: "pending_payment", count: posPending[0].count + ecomPending[0].count },
      { type: "pending_preparation", count: posPrep[0].count + ecomPrep[0].count },
      { type: "low_stock", count: lowStock[0].count },
      { type: "new_orders", count: posPending[0].count + ecomPending[0].count },
      { type: "ready_for_pickup", count: posReady[0].count + ecomReady[0].count },
    ],
  });
}));

// ==================== REPORTS ====================

const dateRange = (query) => {
  const { start_date: startDate, end_date: endDate } = query;
  if (!startDate || !endDate) return { clause: "", params: [] };
  return {
    clause: "AND created_at BETWEEN ? AND ?",
    params: [startDate, `${endDate} 23:59:59`],
  };
};

router.get("/reports/summary", handle(async (req, res) => {
  const { clause, params } = dateRange(req.query);

  const [rows] = await promisePool.query(
    `
    SELECT
      COUNT(*) AS total_orders,
      COUNT(CASE WHEN order_status = 'completed' THEN 1 END) AS completed_orders,
      COUNT(CASE WHEN order_status = 'preparing' THEN 1 END) AS preparing_orders,
      COUNT(CASE WHEN order_status = 'ready_for_pickup' THEN 1 END) AS ready_for_pickup_orders,
      COUNT(CASE WHEN order_status = 'rejected' THEN 1 END) AS rejected_orders,
      COUNT(CASE WHEN payment_status = 'verified' THEN 1 END) AS verified_payments,
      COALESCE(SUM(CASE WHEN order_status = 'completed' THEN total_amount ELSE 0 END), 0) AS completed_revenue,
      COALESCE(SUM(total_amount), 0) AS total_revenue
    FROM (
      SELECT id, order_status, payment_status, total_amount, created_at FROM online_orders WHERE 1=1 ${clause}
      UNION ALL
      SELECT id, REPLACE(LOWER(status), ' ', '_') AS order_status, payment_status, total_amount, created_at
      FROM ecom_orders WHERE 1=1 ${clause}
    ) o
  `,
    [...params, ...params]
  );

  res.json({ success: true, summary: rows[0] });
}));

router.get("/reports/daily-sales", handle(async (req, res) => {
  const { clause, params } = dateRange(req.query);

  const [rows] = await promisePool.query(
    `
    SELECT date, COUNT(*) AS orders, SUM(revenue) AS revenue FROM (
      SELECT DATE(created_at) AS date, 1 AS revenue
      FROM online_orders WHERE order_status != 'rejected' ${clause}
      UNION ALL
      SELECT DATE(created_at) AS date, total_amount AS revenue
      FROM ecom_orders WHERE REPLACE(LOWER(status), ' ', '_') != 'rejected' ${clause}
    ) t
    GROUP BY date ORDER BY date DESC
  `,
    [...params, ...params]
  );

  res.json({ success: true, data: rows });
}));

router.get("/reports/pos-daily-sales", handle(async (req, res) => {
  const { clause, params } = dateRange(req.query);

  const [rows] = await promisePool.query(
    `
    SELECT DATE(created_at) AS date, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
    FROM sales
    WHERE total > 0 ${clause}
    GROUP BY DATE(created_at)
    ORDER BY date DESC
    `,
    params
  );

  res.json({ success: true, data: rows });
}));

router.get("/reports/customer-summary", handle(async (req, res) => {
  const [rows] = await promisePool.query(`
    SELECT c.id,
      COALESCE(NULLIF(c.name, ''), NULLIF(c.full_name, ''), c.email) AS name,
      c.email, COALESCE(NULLIF(c.contact, ''), c.contact_number) AS contact,
      COUNT(*) AS total_orders,
      COALESCE(SUM(o.total_amount), 0) AS total_spent,
      MIN(o.created_at) AS first_order,
      MAX(o.created_at) AS last_order
    FROM customers c
    JOIN (
      SELECT customer_id, total_amount, created_at FROM online_orders WHERE order_status != 'rejected'
      UNION ALL
      SELECT customer_id, total_amount, created_at FROM ecom_orders WHERE REPLACE(LOWER(status), ' ', '_') != 'rejected'
    ) o ON c.id = o.customer_id
    GROUP BY c.id
    ORDER BY total_spent DESC
  `);

  res.json({ success: true, data: rows });
}));

router.get("/reports/best-sellers", handle(async (req, res) => {
  const { start_date: startDate, end_date: endDate } = req.query;
  const clause = startDate && endDate ? "AND {alias}.created_at BETWEEN ? AND ?" : "";
  const window = [startDate, `${endDate} 23:59:59`];

  const [rows] = await promisePool.query(
    `
    SELECT product_name, SUM(quantity) AS total_sold, SUM(total) AS total_revenue FROM (
      SELECT oi.product_name, oi.quantity, oi.total
      FROM order_items oi
      JOIN online_orders o ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE o.order_status != 'rejected' AND p.deleted = 0 ${clause.replace("{alias}", "o")}
      UNION ALL
      SELECT oi.product_name, oi.quantity, (oi.quantity * oi.price) AS total
      FROM ecom_order_items oi
      JOIN ecom_orders o ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE REPLACE(LOWER(o.status), ' ', '_') != 'rejected' AND p.deleted = 0 ${clause.replace("{alias}", "o")}
    ) t
    GROUP BY product_name
    ORDER BY total_sold DESC
    LIMIT 10
  `,
    clause ? [...window, ...window] : []
  );

  res.json({ success: true, data: rows });
}));

// ==================== DASHBOARD STATS ====================

router.get("/dashboard-stats", handle(async (req, res) => {
  const [[products], [categories], [lowStock], [posPending], [ecomPending], [customers]] = await Promise.all([
    promisePool.query("SELECT COUNT(*) AS count FROM products WHERE deleted = 0"),
    promisePool.query("SELECT COUNT(*) AS count FROM categories"),
    promisePool.query("SELECT COUNT(*) AS count FROM products WHERE deleted = 0 AND stock <= 30"),
    promisePool.query("SELECT COUNT(*) AS count FROM online_orders WHERE order_status IN ('pending_payment','verified','preparing')"),
    promisePool.query("SELECT COUNT(*) AS count FROM ecom_orders WHERE status IN ('Pending Payment Verification','Payment Verified','Preparing')"),
    promisePool.query("SELECT COUNT(*) AS count FROM customers"),
  ]);

  res.json({
    success: true,
    stats: {
      total_products: products[0].count,
      total_categories: categories[0].count,
      low_stock: lowStock[0].count,
      pending_orders: posPending[0].count + ecomPending[0].count,
      total_customers: customers[0].count,
    },
  });
}));

// ==================== STOCK TRENDS ====================

router.get("/reports/stock-trends", handle(async (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 365);

  const [products] = await promisePool.query("SELECT id, name, stock, cost_price FROM products WHERE deleted = 0");
  const [sales] = await promisePool.query(
    `SELECT product_id, SUM(quantity) AS units FROM (
       SELECT oi.product_id, oi.quantity FROM order_items oi
       JOIN online_orders o ON oi.order_id = o.id
       WHERE o.order_status != 'rejected' AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       UNION ALL
       SELECT oi.product_id, oi.quantity FROM ecom_order_items oi
       JOIN ecom_orders o ON oi.order_id = o.id
       WHERE REPLACE(LOWER(o.status), ' ', '_') NOT IN ('rejected','cancelled')
         AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     ) t GROUP BY product_id`,
    [days, days]
  );

  const salesMap = new Map(sales.map((s) => [s.product_id, Number(s.units) || 0]));

  const LEAD_TIME_DAYS = 7;
  const SAFETY_STOCK = 10;
  const LOW_STOCK_THRESHOLD = 30;

  const trends = products
    .map((p) => {
      const unitsSold = salesMap.get(p.id) || 0;
      const dailyVelocity = unitsSold / days;
      const daysUntilEmpty = dailyVelocity > 0 ? Math.floor(p.stock / dailyVelocity) : Infinity;
      const reorderPoint = Math.ceil(dailyVelocity * LEAD_TIME_DAYS) + SAFETY_STOCK;
      const stockBelowThreshold = p.stock <= LOW_STOCK_THRESHOLD;
      const needsReorder = stockBelowThreshold || p.stock <= reorderPoint;

      let status = "healthy";
      if (p.stock <= 0) status = "out_of_stock";
      else if (needsReorder || stockBelowThreshold) status = "low";
      else if (dailyVelocity > 0 && daysUntilEmpty < 14) status = "watch";

      return {
        id: p.id,
        name: p.name,
        stock: p.stock,
        cost_price: Number(p.cost_price || 0),
        stock_value: Number(p.cost_price || 0) * p.stock,
        units_sold: unitsSold,
        daily_velocity: Number(dailyVelocity.toFixed(2)),
        days_until_empty: Number.isFinite(daysUntilEmpty) ? daysUntilEmpty : null,
        reorder_point: reorderPoint,
        needs_reorder: needsReorder,
        status,
      };
    })
    .sort((a, b) => b.daily_velocity - a.daily_velocity);

  res.json({
    success: true,
    days,
    summary: {
      total_products: trends.length,
      out_of_stock: trends.filter((t) => t.status === "out_of_stock").length,
      low: trends.filter((t) => t.status === "low").length,
      needs_reorder: trends.filter((t) => t.needs_reorder).length,
      healthy: trends.filter((t) => t.status === "healthy").length,
      total_stock_value: trends.reduce((sum, t) => sum + t.stock_value, 0),
    },
    trends: trends.slice(0, 20),
    reorderList: trends.filter((t) => t.needs_reorder).slice(0, 20),
  });
}));

module.exports = router;
