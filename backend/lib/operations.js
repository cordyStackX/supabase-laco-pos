"use strict";

/**
 * Business logic for the three money paths: POS checkout, restock, and
 * e-commerce payment verification.
 *
 * Every function takes a connection pool as its first argument and returns a
 * plain value, so the same code runs under Express and under the test suite.
 * Nothing here reads process.env or touches req/res.
 */

const crypto = require("crypto");

class OperationError extends Error {
  constructor(message, status = 400, code = "OPERATION_FAILED") {
    super(message);
    this.name = "OperationError";
    this.status = status;
    this.code = code;
  }
}

// No ambiguous glyphs (0/O, 1/I) so codes can be read aloud over the counter.
const PICKUP_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PICKUP_CODE_LENGTH = 6;

/** First receipt number handed out. */
const RECEIPT_START = 1000;

/**
 * Allocates the next POS receipt number.
 *
 * A single UPDATE against one counter row is atomic, so two cashiers checking
 * out at the same moment are always given different numbers. The previous
 * approach read MAX(receipt_id) and added one, which let both cashiers receive
 * the same number and merge two sales into one receipt header.
 *
 * Must be called on the same connection as the rest of the transaction.
 */
async function allocateReceiptId(connection) {
  if (connection.dialect === "postgres") {
    const [rows] = await connection.query(
      "UPDATE receipt_counters SET value = value + 1 WHERE name = 'pos' RETURNING value AS receipt_id"
    );
    if (rows.length === 0) {
      throw new OperationError("Receipt counter is not initialised. Run the database migrations.", 500, "COUNTER_MISSING");
    }
    return Number(rows[0].receipt_id);
  }

  const [result] = await connection.query(
    "UPDATE receipt_counters SET value = LAST_INSERT_ID(value + 1) WHERE name = 'pos'"
  );
  if (result.affectedRows === 0) {
    throw new OperationError("Receipt counter is not initialised. Run the database migrations.", 500, "COUNTER_MISSING");
  }
  const [[row]] = await connection.query("SELECT LAST_INSERT_ID() AS receipt_id");
  return Number(row.receipt_id);
}

function generatePickupCode() {
  // crypto-backed so the code a customer presents at pickup is not derived
  // from a predictable PRNG. Ambiguous characters (0/O, 1/I) are excluded.
  const bytes = crypto.randomBytes(PICKUP_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < PICKUP_CODE_LENGTH; i += 1) {
    code += PICKUP_CODE_CHARS[bytes[i] % PICKUP_CODE_CHARS.length];
  }
  return code;
}

async function withTransaction(pool, fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }
    throw error;
  } finally {
    connection.release();
  }
}

const normaliseItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new OperationError("Cart is empty", 400, "EMPTY_CART");
  }
  return items.map((item, index) => {
    const barcode = item?.barcode === undefined || item?.barcode === null ? "" : String(item.barcode).trim();
    const quantity = Number(item?.quantity ?? 1);
    if (!barcode) {
      throw new OperationError(`Item ${index + 1} is missing a barcode`, 400, "INVALID_ITEM");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new OperationError(`Item ${index + 1} has an invalid quantity`, 400, "INVALID_ITEM");
    }
    return { barcode, quantity };
  });
};

/**
 * Records a POS sale.
 *
 * The receipt number comes from a single auto-increment insert, so two
 * concurrent checkouts can never collide (the previous MAX(receipt_id)+1
 * approach could hand the same number to two cashiers). Product rows are
 * locked FOR UPDATE before stock is read, so a sale can never oversell.
 *
 * The header is inserted first and its total written at the end, which keeps
 * the receipt number allocation inside the same transaction as the items.
 */
async function runCheckout(pool, { items, customerName, checkoutDepartment, staffId }) {
  const cleanItems = normaliseItems(items);
  const name = typeof customerName === "string" && customerName.trim() ? customerName.trim() : null;
  const department =
    typeof checkoutDepartment === "string" && checkoutDepartment.trim() ? checkoutDepartment.trim() : "";

  return withTransaction(pool, async (connection) => {
    const receiptId = await allocateReceiptId(connection);

    await connection.query(
      `INSERT INTO sales (receipt_id, total, adminId, customer_name, checkout_department, customer_type)
       VALUES (?, 0, ?, ?, ?, ?)`,
      [receiptId, staffId ?? null, name, department, department]
    );

    let total = 0;
    const lines = [];

    for (const item of cleanItems) {
      const [rows] = await connection.query(
        "SELECT id, name, price, stock, barcode FROM products WHERE barcode = ? AND deleted = 0 LIMIT 1 FOR UPDATE",
        [item.barcode]
      );

      if (rows.length === 0) {
        throw new OperationError(`Product ${item.barcode} not found`, 404, "PRODUCT_NOT_FOUND");
      }

      const product = rows[0];
      const stock = Number(product.stock || 0);

      if (stock < item.quantity) {
        throw new OperationError(
          `${product.name} is out of stock (requested ${item.quantity}, available ${stock})`,
          409,
          "INSUFFICIENT_STOCK"
        );
      }

      const lineTotal = Number(product.price) * item.quantity;
      total += lineTotal;

      await connection.query("UPDATE products SET stock = stock - ? WHERE id = ?", [
        item.quantity,
        product.id,
      ]);

      await connection.query(
        `INSERT INTO sales_items (product_id, barcode, quantity, price, total, product_name, receipt_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [product.id, product.barcode, item.quantity, product.price, lineTotal, product.name, receiptId]
      );

      await connection.query(
        `INSERT INTO inventory_logs (receipt_id, product_id, product_name, type, quantity, reason, staff)
         VALUES (?, ?, ?, 'OUT', ?, 'Sale', ?)`,
        [receiptId, product.id, product.name, item.quantity, name || "System"]
      );

      lines.push({ productId: product.id, name: product.name, quantity: item.quantity, lineTotal });
    }

    await connection.query("UPDATE sales SET total = ? WHERE receipt_id = ?", [total, receiptId]);

    return { receiptId, total, lines };
  });
}

/**
 * Adds stock to a product and records both the restock document and the
 * inventory ledger entry atomically.
 */
async function runRestock(pool, { productId, amount, supplier, costPrice, notes, staffName }) {
  const productIdNum = Number(productId);
  const quantity = Number(amount);
  const parsedCostPrice = costPrice === undefined || costPrice === null || costPrice === "" ? null : Number(costPrice);

  if (!Number.isInteger(productIdNum) || productIdNum <= 0) {
    throw new OperationError("Invalid product", 400, "INVALID_PRODUCT");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new OperationError("Invalid restock quantity", 400, "INVALID_AMOUNT");
  }
  if (!supplier || !String(supplier).trim()) {
    throw new OperationError("Supplier is required", 400, "SUPPLIER_REQUIRED");
  }
  if (parsedCostPrice !== null && (!Number.isFinite(parsedCostPrice) || parsedCostPrice < 0)) {
    throw new OperationError("Invalid cost price", 400, "INVALID_COST");
  }

  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query("SELECT stock, name FROM products WHERE id = ? FOR UPDATE", [
      productIdNum,
    ]);

    if (rows.length === 0) {
      throw new OperationError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    const productName = rows[0].name;
    const previousStock = Number(rows[0].stock || 0);
    const newStock = previousStock + quantity;

    await connection.query("UPDATE products SET stock = ? WHERE id = ?", [newStock, productIdNum]);

    const [restock] = await connection.query(
      `INSERT INTO restocks (product_id, quantity_added, previous_stock, new_stock, reason, supplier, cost_price, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productIdNum,
        quantity,
        previousStock,
        newStock,
        `${String(supplier).trim()} | ${notes || ""}`,
        String(supplier).trim(),
        parsedCostPrice,
        notes || null,
      ]
    );

    await connection.query(
      `INSERT INTO inventory_logs (product_id, product_name, type, quantity, reason, staff)
       VALUES (?, ?, 'IN', ?, ?, ?)`,
      [productIdNum, productName, quantity, `Restock - ${String(supplier).trim()}`, staffName || "System"]
    );

    return { restockId: restock.insertId, previousStock, newStock, productName };
  });
}

/** Removes stock for an order's lines and writes the matching ledger entries. */
async function applyOrderStockOut(connection, { orderId, items, reason, receiptId }) {
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) continue;

    await connection.query("UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?", [
      quantity,
      item.product_id,
    ]);

    await connection.query(
      `INSERT INTO inventory_logs (product_id, product_name, type, quantity, reason, staff, receipt_id)
       VALUES (?, ?, 'OUT', ?, ?, 'System', ?)`,
      [item.product_id, item.product_name, quantity, reason, receiptId ?? orderId]
    );
  }
}

/**
 * Confirms an e-commerce payment: marks the order verified, allocates a unique
 * pickup code, and releases stock — all in one transaction so a failure can
 * never leave a paid order with no stock movement.
 */
async function verifyEcomPayment(pool, { orderId, verifiedBy, staffName }) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new OperationError("Invalid order", 400, "INVALID_ORDER");
  }

  return withTransaction(pool, async (connection) => {
    const [orders] = await connection.query("SELECT id, status, payment_status FROM ecom_orders WHERE id = ? FOR UPDATE", [
      id,
    ]);

    if (orders.length === 0) {
      throw new OperationError("Order not found", 404, "ORDER_NOT_FOUND");
    }

    if (orders[0].payment_status === "verified") {
      throw new OperationError("Payment is already verified", 409, "ALREADY_VERIFIED");
    }

    let pickupCode = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = generatePickupCode();
      const [clash] = await connection.query("SELECT id FROM ecom_orders WHERE pickup_code = ?", [candidate]);
      if (clash.length === 0) {
        pickupCode = candidate;
        break;
      }
    }
    if (!pickupCode) {
      throw new OperationError("Could not allocate a pickup code", 500, "PICKUP_CODE_EXHAUSTED");
    }

    await connection.query(
      `UPDATE ecom_orders
       SET payment_status = 'verified', status = 'Payment Verified', pickup_code = ?, verified_at = NOW()
       WHERE id = ?`,
      [pickupCode, id]
    );

    await connection.query(
      "UPDATE ecom_payments SET status = 'verified', verified_by = ?, verified_at = NOW() WHERE order_id = ?",
      [verifiedBy ?? null, id]
    );

    const [items] = await connection.query(
      "SELECT product_id, quantity, product_name FROM ecom_order_items WHERE order_id = ?",
      [id]
    );

    await applyOrderStockOut(connection, {
      orderId: id,
      items,
      reason: `Ecommerce Order ${id}`,
      receiptId: id,
    });

    return { orderId: id, pickupCode, itemsReleased: items.length };
  });
}

module.exports = {
  OperationError,
  RECEIPT_START,
  generatePickupCode,
  allocateReceiptId,
  withTransaction,
  runCheckout,
  runRestock,
  applyOrderStockOut,
  verifyEcomPayment,
};
