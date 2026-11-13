"use strict";

if (process.env.DB_CLIENT?.toLowerCase() === "postgres") {
  module.exports = require("./db-postgres");
} else {
const mysql = require("mysql2");

const isProduction = process.env.NODE_ENV === "production";

// Credentials come from the environment. The dev-only fallbacks exist so a
// fresh clone still boots against a local MySQL; production refuses to start
// without an explicit, non-root user.
const config = {
  host: process.env.DB_HOST || (isProduction ? undefined : "localhost"),
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || (isProduction ? undefined : "root"),
  password: process.env.DB_PASSWORD ?? (isProduction ? undefined : ""),
  database: process.env.DB_NAME || (isProduction ? undefined : "pos_bookstore"),
};

const missing = ["host", "user", "database"].filter((key) => !config[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing database configuration: ${missing.map((k) => `DB_${k.toUpperCase()}`).join(", ")}. ` +
      "Set these in the environment or backend/.env."
  );
}

if (isProduction && (!config.password || config.user === "root")) {
  throw new Error(
    "Refusing to start in production with a blank password or the MySQL root user. " +
      "Configure a dedicated least-privilege account via DB_USER / DB_PASSWORD."
  );
}

const pool = mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  queueLimit: 0,
  charset: "utf8mb4",
  namedPlaceholders: false,
  dateStrings: false,
  multipleStatements: false,
  enableKeepAlive: true,
});

const promisePool = pool.promise();
promisePool.dialect = "mysql";

const USAGE = `DB_USER=${config.user}@${config.host}:${config.port}/${config.database}`;

/**
 * Checks that the database is actually reachable and logs the outcome.
 *
 * This is deliberately NOT run at import time. Firing it as a module side effect
 * meant every consumer (tests, short-lived scripts) got unsolicited network I/O
 * the moment it required this file. Scripts that finished quickly and closed the
 * pool raced the in-flight probe, which then failed with "Pool is closed" and
 * printed a scary connection error even though the script had succeeded.
 * Callers that care should await this explicitly.
 *
 * NOTE: this must go through `promisePool`, not `pool`. mysql2's base pool takes
 * a required callback in getConnection(cb) and has no no-argument overload, so
 * `await pool.getConnection()` resolves to undefined (reporting a false success)
 * and a later handshake failure calls `cb(err)` with cb undefined, which throws
 * an unhandled "cb is not a function" and takes the process down.
 */
async function verifyConnection({ exitOnFailure = isProduction } = {}) {
  let connection;
  try {
    connection = await promisePool.getConnection();
    console.log(`[OK] Connected to MySQL (${USAGE})`);
    return true;
  } catch (error) {
    console.error(`[FAIL] MySQL connection failed (${USAGE}):`, error.message);
    console.error("   Check that MySQL is running and DB_* variables are correct.");
    if (exitOnFailure) process.exit(1);
    return false;
  } finally {
    if (connection) connection.release();
  }
}

// NOTE: `pool` is exported directly, and `config` is attached to it. mysql2's
// Pool keeps its own normalised configuration on a `config` property, so
// attaching a plain object under that same name silently replaces it and every
// later pool.promise() call throws. Do not export a key called `config` here.
module.exports = pool;
module.exports.promisePool = promisePool;
module.exports.dbConfig = config;
module.exports.verifyConnection = verifyConnection;
}
