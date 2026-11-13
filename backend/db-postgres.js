"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool, types } = require("pg");

function buildConnectionConfig(env = process.env) {
  const config = {
    host: env.PGHOST || env.DB_HOST,
    port: Number(env.PGPORT || env.DB_PORT) || 5432,
    user: env.PGUSER || env.DB_USER,
    password: env.PGPASSWORD ?? env.DB_PASSWORD,
    database: env.PGDATABASE || env.DB_NAME,
  };
  const missing = ["host", "user", "database"].filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing PostgreSQL configuration: ${missing.map((key) => `PG${key.toUpperCase()}`).join(", ")}.`
    );
  }
  return config;
}

function buildSslOptions({ enabled, caCertificate } = {}) {
  if (!enabled) return undefined;
  return {
    rejectUnauthorized: true,
    ...(caCertificate ? { ca: caCertificate } : {}),
  };
}

const sslEnabled = process.env.DB_SSL === "true" || process.env.DB_SSL === "1";
const sslCaPath = process.env.DB_SSL_CA_PATH;
const sslCaCertificate = process.env.DB_SSL_CA_CERT || (sslCaPath
  ? fs.readFileSync(path.resolve(sslCaPath), "utf8")
  : undefined);
if ((sslCaPath || sslCaCertificate) && !sslEnabled) {
  throw new Error("DB_SSL must be enabled when a PostgreSQL CA certificate is configured.");
}
const ssl = buildSslOptions({ enabled: sslEnabled, caCertificate: sslCaCertificate });

// PostgreSQL returns COUNT(*) as int8 strings by default; normalize it to the
// number values the existing API returns from MySQL.
types.setTypeParser(20, (value) => Number(value));

const pool = new Pool({
  ...buildConnectionConfig(),
  ssl,
  max: Number(process.env.DB_POOL_SIZE) || 10,
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 10_000,
  idleTimeoutMillis: 30_000,
});

const ID_TABLES = new Set([
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
]);

function replacePlaceholders(sql, params = []) {
  let output = "";
  const values = [];
  let inputIndex = 0;
  let outputIndex = 0;
  let quote = null;
  let dollarQuote = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        output += dollarQuote;
        index += dollarQuote.length - 1;
        dollarQuote = null;
      } else {
        output += char;
      }
      continue;
    }

    if (quote) {
      output += char;
      if (char === quote && next === quote) {
        output += next;
        index += 1;
      } else if (char === quote && sql[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      continue;
    }

    if (char === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z_0-9]*\$/);
      if (match) {
        dollarQuote = match[0];
        output += dollarQuote;
        index += dollarQuote.length - 1;
        continue;
      }
    }

    if (char === "?") {
      const value = params[inputIndex];
      inputIndex += 1;
      const prefix = output.trimEnd().toLowerCase();
      if (Array.isArray(value) && prefix.endsWith("values") && value.every(Array.isArray)) {
        if (value.length === 0) throw new Error("Bulk INSERT requires at least one row.");
        const width = value[0].length;
        if (width === 0 || value.some((row) => row.length !== width)) {
          throw new Error("Bulk INSERT rows must all contain the same number of values.");
        }
        output += value.map((row) => {
          const placeholders = row.map((item) => {
            values.push(item);
            outputIndex += 1;
            return `$${outputIndex}`;
          });
          return `(${placeholders.join(", ")})`;
        }).join(", ");
      } else if (Array.isArray(value) && /\bIN\s*\($/i.test(output.trimEnd())) {
        output = output.trimEnd();
        if (value.length === 0) {
          output += "NULL";
        } else {
          output += value.map((item) => {
            values.push(item);
            outputIndex += 1;
            return `$${outputIndex}`;
          }).join(", ");
        }
      } else {
        outputIndex += 1;
        values.push(value);
        output += `$${outputIndex}`;
      }
      continue;
    }

    output += char;
  }

  return { sql: output, params: values };
}

function translateSql(mysqlSql) {
  let sql = replacePlaceholders(mysqlSql).sql
    .replace(/`/g, "")
    .replace(/(?<!")\badminId\b(?!")/g, '"adminId"')
    .replace(/<=>/g, "IS NOT DISTINCT FROM")
    .replace(/\bIFNULL\s*\(/gi, "COALESCE(")
    .replace(/\bDATABASE\s*\(\s*\)/gi, "current_schema()");

  sql = sql.replace(
    /\bDATE_FORMAT\s*\(\s*([^,]+?)\s*,\s*'%Y-%m'\s*\)/gi,
    "TO_CHAR($1, 'YYYY-MM')"
  );
  sql = sql.replace(
    /\bGROUP_CONCAT\s*\(\s*([^)]+?)\s+SEPARATOR\s+'((?:''|[^'])*)'\s*\)/gi,
    (_, expression, separator) => `STRING_AGG(${expression.trim()}::text, '${separator.replace(/''/g, "'")}')`
  );
  sql = sql.replace(
    /\bDATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+(\$\d+|\d+)\s+DAY\s*\)/gi,
    "NOW() - ($1 * INTERVAL '1 day')"
  );
  sql = sql.replace(/\bCAST\s*\(([^)]+?)\s+AS\s+UNSIGNED\s*\)/gi, "CAST($1 AS BIGINT)");
  sql = sql.replace(
    /^\s*SHOW TABLES LIKE '(\w+)'\s*;?\s*$/i,
    (_, table) => `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`
  );
  sql = sql.replace(/^\s*SHOW TABLES\s*;?\s*$/i, "SELECT tablename AS table_name FROM pg_tables WHERE schemaname = current_schema()");
  sql = sql.replace(
    /^\s*SHOW COLUMNS FROM (\w+)(?: LIKE '(\w+)')?\s*;?\s*$/i,
    (_, table, column) => column
      ? `SELECT column_name AS "Field" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = '${column}'`
      : `SELECT column_name AS "Field" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
  );

  const insert = sql.match(/^\s*INSERT\s+INTO\s+(\w+)\b/i);
  if (insert && ID_TABLES.has(insert[1].toLowerCase()) && !/\bRETURNING\b/i.test(sql)) {
    sql = `${sql.trim().replace(/;\s*$/, "")} RETURNING id`;
  }

  return sql;
}

function prepareQuery(mysqlSql, params = []) {
  const prepared = replacePlaceholders(mysqlSql, params);
  return { sql: translateSql(prepared.sql), params: prepared.params };
}

function normaliseError(error) {
  if (error.code === "23505") error.code = "ER_DUP_ENTRY";
  else if (error.code === "23503") error.code = "ER_NO_REFERENCED_ROW";
  else if (error.code === "23514") error.code = "ER_CHECK_CONSTRAINT_VIOLATED";
  return error;
}

function wrapClient(client) {
  return {
    dialect: "postgres",
    async query(mysqlSql, params = []) {
      const { sql, params: translatedParams } = prepareQuery(mysqlSql, params);
      try {
        const result = await client.query(sql, translatedParams);
        if (result.command === "INSERT") {
          const header = {
            affectedRows: result.rowCount || 0,
            ...(result.rows?.[0]?.id !== undefined ? { insertId: result.rows[0].id } : {}),
          };
          return [header, result.fields];
        }
        if (result.command === "SELECT" || result.command === "SHOW" || /\bRETURNING\b/i.test(sql)) {
          return [result.rows, result.fields];
        }
        const header = {
          affectedRows: result.rowCount || 0,
          ...(result.rows?.[0]?.id !== undefined ? { insertId: result.rows[0].id } : {}),
        };
        return [header, result.fields];
      } catch (error) {
        throw normaliseError(error);
      }
    },
    beginTransaction: () => client.query("BEGIN"),
    commit: () => client.query("COMMIT"),
    rollback: () => client.query("ROLLBACK"),
    release: () => client.release(),
  };
}

const promisePool = {
  async query(sql, params = []) {
    return wrapClient(pool).query(sql, params);
  },
  async getConnection() {
    return wrapClient(await pool.connect());
  },
  end: () => pool.end(),
};

async function verifyConnection({ exitOnFailure = false } = {}) {
  let client;
  try {
    client = await pool.connect();
    await client.query("SELECT 1");
    console.log("[OK] Connected to PostgreSQL");
    return true;
  } catch (error) {
    console.error("[FAIL] PostgreSQL connection failed:", error.message);
    if (exitOnFailure) process.exit(1);
    return false;
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  promisePool,
  verifyConnection,
  translateSql,
  prepareQuery,
  wrapClient,
  buildSslOptions,
  buildConnectionConfig,
};
