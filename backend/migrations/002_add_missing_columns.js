"use strict";

/**
 * Adds columns that predate the migration system. Every check is guarded, so
 * this is a no-op on a database created from 001_schema.sql and repairs an
 * older installation exactly once.
 *
 * This replaces the ~25 unconditional `ensureColumn()` calls that used to run
 * on every boot, which could race when two instances started together.
 */

const COLUMNS = [
  // POS
  ["sales_items", "receipt_id", "receipt_id INT NULL AFTER id"],
  ["sales", "customer_name", "customer_name VARCHAR(255) NULL"],
  ["sales", "customer_type", "customer_type VARCHAR(100) DEFAULT ''"],
  ["sales", "checkout_department", "checkout_department VARCHAR(100) DEFAULT ''"],
  ["sales", "receipt_id", "receipt_id INT NULL"],
  ["sales", "adminId", "adminId INT NULL"],
  ["inventory_logs", "receipt_id", "receipt_id INT NULL"],
  ["admins", "can_view_inventory_logs", "can_view_inventory_logs TINYINT(1) NOT NULL DEFAULT 0"],
  ["products", "department", "department VARCHAR(100) DEFAULT ''"],
  ["products", "barcode", "barcode VARCHAR(100) NULL"],
  ["products", "size", "size VARCHAR(50) NULL"],
  ["products", "sizes", "sizes JSON NULL"],
  ["products", "cost_price", "cost_price DECIMAL(10,2) DEFAULT 0"],
  ["products", "deleted", "deleted TINYINT(1) NOT NULL DEFAULT 0"],
  ["products", "description", "description TEXT NULL"],

  // Shared customers table
  ["customers", "name", "name VARCHAR(255) NOT NULL DEFAULT ''"],
  ["customers", "contact", "contact VARCHAR(50) NULL"],
  ["customers", "full_name", "full_name VARCHAR(255) NULL"],
  ["customers", "contact_number", "contact_number VARCHAR(20) NULL"],
  ["customers", "role", "role VARCHAR(20) NOT NULL DEFAULT 'customer'"],
  ["customers", "updated_at", "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"],

  // POS-side online orders
  ["order_items", "product_name", "product_name VARCHAR(255) NULL"],
  ["order_items", "barcode", "barcode VARCHAR(100) NULL"],
  ["order_items", "price", "price DECIMAL(10,2) NOT NULL DEFAULT 0"],
  ["order_items", "total", "total DECIMAL(10,2) NOT NULL DEFAULT 0"],
  ["order_items", "created_at", "created_at DATETIME DEFAULT CURRENT_TIMESTAMP"],

  // E-commerce
  ["ecom_order_items", "product_name", "product_name VARCHAR(255) NULL"],
  ["ecom_order_items", "price", "price DECIMAL(10,2) NOT NULL DEFAULT 0"],
  ["ecom_order_items", "selected_size", "selected_size VARCHAR(50) NULL"],
  ["ecom_orders", "verified_at", "verified_at DATETIME NULL"],
  ["ecom_orders", "payment_method", "payment_method VARCHAR(50) NULL"],
  ["ecom_orders", "pickup_code", "pickup_code VARCHAR(10) NULL"],
  ["ecom_orders", "reference_number", "reference_number VARCHAR(255) NULL"],
  ["ecom_payments", "verified_by", "verified_by INT NULL"],
  ["ecom_payments", "verified_at", "verified_at DATETIME NULL"],

  // OTP
  ["otp_codes", "attempts", "attempts INT NOT NULL DEFAULT 0 AFTER used"],
];

// Tables that may not exist yet on a very old database. Skipped rather than
// failing, because 001_schema.sql creates the full set on a fresh install.
const OPTIONAL_TABLES = new Set([
  "ecom_orders",
  "ecom_order_items",
  "ecom_payments",
  "ecom_carts",
  "ecom_cart_items",
  "order_items",
  "order_payments",
  "otp_codes",
  "inventory_logs",
  "restocks",
  "sales_items",
]);

async function tableExists(pool, table) {
  const [rows] = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [table]
  );
  return rows.length > 0;
}

async function columnExists(pool, table, column) {
  const [rows] = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column]
  );
  return rows.length > 0;
}

async function up(pool) {
  for (const [table, column, definition] of COLUMNS) {
    if (!(await tableExists(pool, table))) {
      if (OPTIONAL_TABLES.has(table)) {
        console.log(`   skip ${table}.${column} (table absent)`);
        continue;
      }
      throw new Error(`Required table "${table}" does not exist. Run 001_schema.sql first.`);
    }

    if (await columnExists(pool, table, column)) continue;

    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
    console.log(`   added ${table}.${column}`);
  }
}

module.exports = { up };
