"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { splitStatements } = require("../scripts/migrate");

test("keeps PostgreSQL function bodies intact while splitting schema statements", () => {
  const schemaPath = path.join(__dirname, "..", "migrations", "postgres", "001_schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  const statements = splitStatements(sql);
  const functionSql = statements.find((statement) => statement.startsWith("CREATE OR REPLACE FUNCTION"));

  assert.ok(functionSql, "schema should contain the timestamp trigger function");
  assert.match(functionSql, /NEW\.updated_at = CURRENT_TIMESTAMP;/);
  assert.match(functionSql, /RETURN NEW;/);
  assert.match(functionSql, /\$\$ LANGUAGE plpgsql$/);
  assert.ok(statements.some((statement) => statement.startsWith("CREATE TRIGGER products_updated_at")));
  assert.ok(statements.some((statement) => statement.startsWith("CREATE TABLE IF NOT EXISTS sales_backup")));
  assert.ok(statements.some((statement) => statement.startsWith("CREATE TABLE IF NOT EXISTS receipt_counters")));
  assert.ok(statements.some((statement) => statement.includes('CREATE INDEX IF NOT EXISTS idx_sales_backup_receipt')));
});
