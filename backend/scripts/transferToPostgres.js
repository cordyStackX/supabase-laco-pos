"use strict";

require("dotenv").config();

const mysql = require("mysql2/promise");
const { promisePool: postgresPool } = require("../db-postgres");

const mysqlConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionLimit: 2,
};
const missingMysqlConfig = ["host", "database", "user"].filter((key) => !mysqlConfig[key]);
if (missingMysqlConfig.length > 0) {
  throw new Error(`MySQL source configuration is missing: ${missingMysqlConfig.join(", ")}.`);
}
const mysqlPool = mysql.createPool(mysqlConfig);

const TABLES = [
  "categories",
  "products",
  "admins",
  "sales",
  "sales_backup",
  "sales_items",
  "restocks",
  "inventory_logs",
  "customers",
  "online_orders",
  "order_items",
  "order_payments",
  "ecom_orders",
  "ecom_order_items",
  "ecom_payments",
  "ecom_carts",
  "ecom_cart_items",
  "otp_codes",
  "receipt_counters",
];

const LEGACY_EMPTY_TABLES = new Set([
  "cart_items",
  "carts",
  "orders",
  "payments",
  "staff_permissions",
]);

const BATCH_SIZE = 100;

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unexpected database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function quoteMysqlIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unexpected MySQL identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
}

async function copyTable(connection, table, columns, rows) {
  const columnList = columns.map(quoteIdentifier).join(", ");
  const identityClause = columns.includes("id") ? " OVERRIDING SYSTEM VALUE" : "";

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const params = [];
    const values = batch.map((row) => {
      const rowPlaceholders = columns.map((column) => {
        params.push(row[column] ?? null);
        return "?";
      });
      return `(${rowPlaceholders.join(", ")})`;
    });
    const sql = `INSERT INTO ${quoteIdentifier(table)} (${columnList})${identityClause} VALUES ${values.join(", ")}`;
    await connection.query(sql, params);
  }
}

async function main() {
  if (!process.argv.includes("--confirm-empty-target")) {
    throw new Error(
      "Refusing to copy data without --confirm-empty-target. The target database must be newly migrated and empty."
    );
  }

  const [mysqlTables] = await mysqlPool.query("SHOW TABLES");
  const sourceNames = new Set(mysqlTables.map((row) => Object.values(row)[0]));
  const allowedSources = new Set([...TABLES, ...LEGACY_EMPTY_TABLES, "schema_migrations"]);
  const unknownTables = [...sourceNames].filter((table) => !allowedSources.has(table));
  if (unknownTables.length > 0) {
    throw new Error(
      `MySQL contains tables not covered by this transfer: ${unknownTables.join(", ")}. ` +
        "Review and migrate these tables explicitly before switching."
    );
  }
  for (const table of LEGACY_EMPTY_TABLES) {
    if (!sourceNames.has(table)) continue;
    const [[{ count }]] = await mysqlPool.query(
        `SELECT COUNT(*) AS count FROM ${quoteMysqlIdentifier(table)}`
    );
    if (Number(count) > 0) {
        throw new Error(
          `Legacy table ${table} contains ${count} row(s) and is not represented in the PostgreSQL schema. ` +
            "Migrate those rows explicitly before switching."
        );
    }
  }
  const sourceTables = TABLES.filter((table) => sourceNames.has(table));
  if (sourceTables.length === 0) throw new Error("No known application tables were found in the MySQL database.");

  const [targetTables] = await postgresPool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()"
  );
  const targetNames = new Set(targetTables.map((row) => row.table_name));
  const missingTables = sourceTables.filter((table) => !targetNames.has(table));
  if (missingTables.length > 0) {
    throw new Error(`Target schema is missing tables: ${missingTables.join(", ")}. Run the PostgreSQL migrations first.`);
  }

  const tablePlans = [];
  for (const table of sourceTables) {
    const [sourceColumns] = await mysqlPool.query(`SHOW COLUMNS FROM ${quoteMysqlIdentifier(table)}`);
    const [targetColumns] = await postgresPool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?",
      [table]
    );
    const targetColumnNames = new Set(targetColumns.map((row) => row.column_name));
    const sourceColumnNames = sourceColumns.map((column) => column.Field);
    const unknownColumns = sourceColumnNames.filter((column) => !targetColumnNames.has(column));

    if (unknownColumns.length > 0) {
      throw new Error(
        `MySQL table ${table} has columns not represented in the PostgreSQL schema: ${unknownColumns.join(", ")}. ` +
          "Update the target schema before transferring data."
      );
    }

    const columns = sourceColumnNames;
    if (table !== "receipt_counters" && !columns.includes("id")) {
      throw new Error(`MySQL table ${table} has no id column; this transfer cannot safely page its rows.`);
    }
    const [[{ count }]] = await mysqlPool.query(
      `SELECT COUNT(*) AS count FROM ${quoteMysqlIdentifier(table)}`
    );
    tablePlans.push({ table, columns, count: Number(count) });
  }

  const connection = await postgresPool.getConnection();
  const counts = [];
  try {
    await connection.beginTransaction();
    for (const { table } of tablePlans) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
      const count = Number(rows[0].count);
      const isSeedCounter = table === "receipt_counters" && count === 1;
      if (count > 0 && !isSeedCounter) {
        throw new Error(`Target table ${table} is not empty (${count} row(s)); refusing to merge or overwrite data.`);
      }
      if (isSeedCounter) {
        const [seed] = await connection.query(
          `SELECT name FROM ${quoteIdentifier(table)} WHERE name = 'pos'`
        );
        if (seed.length !== 1) {
          throw new Error("Target receipt counter is not the expected fresh-schema seed.");
        }
      }
    }

    for (const { table, columns, count } of tablePlans) {
      if (table === "receipt_counters") continue;
      let lastId = 0;
      let copied = 0;
      while (copied < count) {
        const [rows] = await mysqlPool.query(
          `SELECT * FROM ${quoteMysqlIdentifier(table)} WHERE id > ? ORDER BY id LIMIT ${BATCH_SIZE}`,
          [lastId]
        );
        if (rows.length === 0) {
          throw new Error(`Source table ${table} changed during transfer; stop writes and retry.`);
        }
        await copyTable(connection, table, columns, rows);
        lastId = Number(rows[rows.length - 1].id);
        copied += rows.length;
      }
      if (copied !== count) throw new Error(`Source table ${table} changed during transfer; stop writes and retry.`);
      counts.push({ table, count });
    }

    const counterPlan = tablePlans.find(({ table }) => table === "receipt_counters");
    let sourceCounter = 1000;
    if (counterPlan) {
      const [counterRows] = await mysqlPool.query(
        "SELECT value FROM receipt_counters WHERE name = 'pos'"
      );
      if (counterRows[0]) sourceCounter = Number(counterRows[0].value);
    }

    const [[maxReceipt]] = await connection.query(`
      SELECT GREATEST(
        COALESCE((SELECT MAX(receipt_id) FROM sales), 1000),
        COALESCE((SELECT MAX(receipt_id) FROM sales_backup), 1000),
        COALESCE((SELECT MAX(receipt_id::bigint) FROM sales_items WHERE receipt_id::text ~ '^[0-9]+$'), 1000),
        COALESCE((SELECT MAX(receipt_id) FROM inventory_logs), 1000),
        ?
      ) AS value
    `, [sourceCounter]);
    await connection.query(
      "UPDATE receipt_counters SET value = ? WHERE name = 'pos'",
      [Number(maxReceipt.value)]
    );

    for (const { table, columns } of tablePlans) {
      if (!columns.includes("id")) continue;
      const identifier = quoteIdentifier(table);
      await connection.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${identifier}`
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await Promise.all([mysqlPool.end(), postgresPool.end()]);
  }

  console.log("Data transfer completed:");
  for (const { table, count } of counts) {
    console.log(`  ${table}: ${count} row(s)`);
  }
  console.log("  receipt_counters: synchronized to the highest existing receipt number");
}

main().catch(async (error) => {
  console.error(`Data transfer failed: ${error.stack || error.message}`);
  await Promise.allSettled([mysqlPool.end(), postgresPool.end()]);
  process.exitCode = 1;
});
