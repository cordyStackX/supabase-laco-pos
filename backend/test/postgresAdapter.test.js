"use strict";

const test = require("node:test");
const assert = require("node:assert");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/test";
const { translateSql, prepareQuery, wrapClient, buildSslOptions } = require("../db-postgres");

test("translates the MySQL SQL patterns used by existing routes", () => {
  assert.strictEqual(
    translateSql("SELECT id FROM ecom_cart_items WHERE selected_size <=> ?"),
    "SELECT id FROM ecom_cart_items WHERE selected_size IS NOT DISTINCT FROM $1"
  );
  assert.strictEqual(
    translateSql("SELECT DATE_FORMAT(created_at, '%Y-%m') AS month FROM sales"),
    "SELECT TO_CHAR(created_at, 'YYYY-MM') AS month FROM sales"
  );
  assert.strictEqual(
    translateSql("SELECT GROUP_CONCAT(product_name SEPARATOR ', ') AS names FROM order_items"),
    "SELECT STRING_AGG(product_name::text, ', ') AS names FROM order_items"
  );
  assert.strictEqual(
    translateSql("SELECT * FROM orders WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"),
    "SELECT * FROM orders WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')"
  );
});

test("converts placeholders outside quoted values and adds returning ids to inserts", () => {
  assert.strictEqual(
    translateSql("INSERT INTO products (name, barcode) VALUES (?, '?')"),
    'INSERT INTO products (name, barcode) VALUES ($1, \'?\') RETURNING id'
  );
});

test("translates the legacy schema discovery queries", () => {
  assert.match(translateSql("SHOW TABLES LIKE 'categories'"), /information_schema\.tables/);
  assert.match(translateSql("SHOW COLUMNS FROM products LIKE 'created_at'"), /information_schema\.columns/);
});

test("preserves already-quoted case-sensitive PostgreSQL identifiers", () => {
  assert.strictEqual(
    translateSql('CREATE TABLE sales ("adminId" INTEGER)'),
    'CREATE TABLE sales ("adminId" INTEGER)'
  );
});

test("expands MySQL bulk VALUES and array IN placeholders", () => {
  assert.deepStrictEqual(
    prepareQuery(
      "INSERT INTO order_items (order_id, product_id) VALUES ?",
      [[[10, 1], [10, 2]]]
    ),
    {
      sql: "INSERT INTO order_items (order_id, product_id) VALUES ($1, $2), ($3, $4) RETURNING id",
      params: [10, 1, 10, 2],
    }
  );
  assert.deepStrictEqual(
    prepareQuery("SELECT id FROM products WHERE id IN (?) AND category = ?", [[3, 7], "Books"]),
    {
      sql: "SELECT id FROM products WHERE id IN ($1, $2) AND category = $3",
      params: [3, 7, "Books"],
    }
  );
});

test("preserves MySQL-style insert metadata and supports rows from update returning", async () => {
  const client = {
    async query(sql) {
      if (sql.startsWith("INSERT INTO products")) {
        assert.match(sql, /RETURNING id$/);
        return { command: "INSERT", rowCount: 1, rows: [{ id: 41 }], fields: [] };
      }
      return { command: "UPDATE", rowCount: 1, rows: [{ receipt_id: "1001" }], fields: [] };
    },
  };
  const connection = wrapClient(client);

  const [insert] = await connection.query("INSERT INTO products (name) VALUES (?)", ["Book"]);
  assert.strictEqual(insert.insertId, 41);
  assert.strictEqual(insert.affectedRows, 1);

  const [updatedRows] = await connection.query(
    "UPDATE receipt_counters SET value = value + 1 RETURNING value AS receipt_id"
  );
  assert.strictEqual(updatedRows[0].receipt_id, "1001");
});

test("keeps TLS verification enabled and accepts an explicitly trusted CA", () => {
  const ssl = buildSslOptions({ enabled: true, caCertificate: "trusted root certificate" });
  assert.deepStrictEqual(ssl, {
    rejectUnauthorized: true,
    ca: "trusted root certificate",
  });
  assert.strictEqual(buildSslOptions({ enabled: false, caCertificate: "ignored" }), undefined);
});
