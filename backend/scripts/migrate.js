"use strict";

/**
 * Forward-only migration runner.
 *
 *   npm run migrate            apply everything pending
 *   npm run migrate -- --status  list applied / pending without changing anything
 *
 * Each file in backend/migrations runs at most once; applied names are
 * recorded in schema_migrations. A MySQL advisory lock prevents two instances
 * booting at the same time from racing.
 *
 * Supported files:
 *   NNN_name.sql  executed statement by statement
 *   NNN_name.js   module exporting `up(pool)` (and optionally `down(pool)`)
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { promisePool } = require("../db");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const LOCK_NAME = "lccb_pos_schema_migrations";
const LOCK_TIMEOUT_SECONDS = 10;
const POSTGRES_MIGRATIONS_DIR = path.join(MIGRATIONS_DIR, "postgres");

const stripComments = (sql) =>
  sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");

const splitStatements = (sql) =>
  (() => {
    const source = stripComments(sql);
    const statements = [];
    let statement = "";
    let dollarQuote = null;

    for (let index = 0; index < source.length; index += 1) {
      if (dollarQuote) {
        if (source.startsWith(dollarQuote, index)) {
          statement += dollarQuote;
          index += dollarQuote.length - 1;
          dollarQuote = null;
        } else {
          statement += source[index];
        }
        continue;
      }

      if (source[index] === "$") {
        const match = source.slice(index).match(/^\$[A-Za-z_0-9]*\$/);
        if (match) {
          dollarQuote = match[0];
          statement += dollarQuote;
          index += dollarQuote.length - 1;
          continue;
        }
      }

      if (source[index] === ";") {
        if (statement.trim()) statements.push(statement.trim());
        statement = "";
      } else {
        statement += source[index];
      }
    }

    if (statement.trim()) statements.push(statement.trim());
    return statements;
  })();

async function ensureMigrationsTable() {
  await promisePool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

const listFiles = () =>
  fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /\.(sql|js)$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

async function appliedNames() {
  const [rows] = await promisePool.query("SELECT name FROM schema_migrations");
  return new Set(rows.map((row) => row.name));
}

async function runSqlFile(file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  const statements = splitStatements(sql);
  console.log(`   ${statements.length} statement(s)`);
  for (const statement of statements) {
    await promisePool.query(statement);
  }
}

async function runJsFile(file) {
  const modulePath = path.join(MIGRATIONS_DIR, file);
  delete require.cache[require.resolve(modulePath)];
  const migration = require(modulePath);
  if (typeof migration.up !== "function") {
    throw new Error(`${file} must export an up(pool) function`);
  }
  await migration.up(promisePool);
}

async function main() {
  const statusOnly = process.argv.includes("--status");

  if (process.env.DB_CLIENT?.toLowerCase() === "postgres") {
    await runPostgresMigrations({ statusOnly });
    return;
  }

  await ensureMigrationsTable();

  const [[lockRow]] = await promisePool.query("SELECT GET_LOCK(?, ?) AS acquired", [
    LOCK_NAME,
    LOCK_TIMEOUT_SECONDS,
  ]);
  if (!lockRow || lockRow.acquired !== 1) {
    throw new Error("Could not acquire the migration lock; another instance may be migrating.");
  }

  try {
    const applied = await appliedNames();
    const files = listFiles();
    const pending = files.filter((file) => !applied.has(file));

    if (statusOnly) {
      console.log("\nMigration status\n");
      for (const file of files) {
        console.log(`  ${applied.has(file) ? "[applied]" : "[pending]"} ${file}`);
      }
      console.log("");
      return;
    }

    if (pending.length === 0) {
      console.log("✅ Database is up to date. No migrations to apply.");
      return;
    }

    console.log(`\nApplying ${pending.length} migration(s)...\n`);

    for (const file of pending) {
      console.log(`▶ ${file}`);
      const started = Date.now();
      try {
        if (file.endsWith(".sql")) {
          await runSqlFile(file);
        } else {
          await runJsFile(file);
        }
      } catch (error) {
        console.error(`✖ ${file} failed: ${error.message}`);
        throw error;
      }
      // Recorded only after the migration succeeds, so a crash mid-way leaves
      // the migration pending and it is retried on the next run.
      await promisePool.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
      console.log(`✔ ${file} (${Date.now() - started}ms)`);
    }

    console.log("\n✅ Migrations applied.\n");
  } finally {
    await promisePool.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]).catch(() => {});
    await promisePool.end().catch(() => {});
  }
}

async function runPostgresMigrations({ statusOnly }) {
  const connection = await promisePool.getConnection();
  try {
    await connection.query("SELECT pg_advisory_lock(hashtext(?))", [LOCK_NAME]);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [appliedRows] = await connection.query("SELECT name FROM schema_migrations");
    const applied = new Set(appliedRows.map((row) => row.name));
    const files = fs
      .readdirSync(POSTGRES_MIGRATIONS_DIR)
      .filter((name) => /\.sql$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const pending = files.filter((file) => !applied.has(file));

    if (statusOnly) {
      console.log("\nPostgreSQL migration status\n");
      for (const file of files) {
        console.log(`  ${applied.has(file) ? "[applied]" : "[pending]"} ${file}`);
      }
      console.log("");
      return;
    }

    if (pending.length === 0) {
      console.log("✅ PostgreSQL database is up to date.");
      return;
    }

    for (const file of pending) {
      console.log(`▶ ${file}`);
      const sql = fs.readFileSync(path.join(POSTGRES_MIGRATIONS_DIR, file), "utf8");
      await connection.beginTransaction();
      try {
        for (const statement of splitStatements(sql)) {
          await connection.query(statement);
        }
        await connection.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
      console.log(`✔ ${file}`);
    }
  } finally {
    await connection.query("SELECT pg_advisory_unlock(hashtext(?))", [LOCK_NAME]).catch(() => {});
    connection.release();
    await promisePool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("\nMigration run failed:", error.message);
    process.exit(1);
  });
}

module.exports = { splitStatements };
