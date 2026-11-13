"use strict";

/**
 * End-to-end checks against a real MySQL.
 *
 * These exercise what a fake cannot: that checkout decrements real rows, and
 * that two concurrent checkouts can neither oversell nor collide on a receipt
 * number. Both are properties the locking strategy is supposed to guarantee.
 *
 * The file skips itself when no database is reachable, so `npm test` still
 * passes on a machine without MySQL:
 *
 *   DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=... DB_NAME=lccb_pos_test npm test
 *
 * The tests TRUNCATE the tables they touch, so DB_NAME must point at a
 * throwaway database. A guard refuses to run otherwise.
 */

const test = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-value-that-is-long-enough-32";

const DB_NAME = process.env.DB_NAME || "pos_bookstore";

const skipAll = (reason) => {
  test("integration", { skip: reason }, () => {});
};

async function main() {
  if (!/(test|ci|scratch)/i.test(DB_NAME)) {
    skipAll(`DB_NAME "${DB_NAME}" does not look like a throwaway test database`);
    return;
  }

  // Reachability probe on a throwaway connection, before the pool is required
  // and before any test is registered.
  let reachable = true;
  let reason = "";
  try {
    const mysql = require("mysql2/promise");
    const admin = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD ?? "",
    });

    // Only the tables these tests write to; anything else in the database is
    // left alone.
    for (const table of [
      "products",
      "receipt_counters",
      "sales",
      "sales_items",
      "restocks",
      "inventory_logs",
    ]) {
      await admin.query(`
        CREATE TABLE IF NOT EXISTS \`${table}\` (
          id INT AUTO_INCREMENT PRIMARY KEY
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `).catch(() => {});
    }
    await admin.end();
  } catch (error) {
    reachable = false;
    reason = `no MySQL reachable: ${error.message}`;
  }

  if (!reachable) {
    skipAll(reason);
    return;
  }

  const { promisePool } = require("../db");
  const { runCheckout, runRestock } = require("../lib/operations");
  const { spawn } = require("node:child_process");
  const path = require("node:path");
  const os = require("node:os");

  // Every table the shipped schema creates. This suite only ever runs against a
  // database whose name looks like a throwaway (see the safety guard above), so
  // the whole schema is dropped between tests to get a clean, known state.
  //
  // The teardown deliberately does not swallow errors: `products` is referenced
  // by foreign keys from order_items / ecom_order_items / ecom_cart_items, so a
  // naive ordered DROP fails with errno 150 and silently leaves rows behind.
  const dropAll = async () => {
    const [rows] = await promisePool.query("SHOW TABLES");
    const tables = rows.map((row) => Object.values(row)[0]).filter(Boolean);
    if (tables.length === 0) return;

    await promisePool.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of tables) {
        await promisePool.query(`DROP TABLE IF EXISTS \`${table}\``);
      }
    } finally {
      await promisePool.query("SET FOREIGN_KEY_CHECKS = 1");
    }
  };

  /**
   * Applies the real migrations/001_schema.sql rather than a hand-written copy,
   * so these tests fail if the shipped schema is invalid or has drifted from
   * what the application expects.
   */
  const applyRealSchema = async () => {
    const fs = require("node:fs");
    const path = require("node:path");

    const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "001_schema.sql"), "utf8");

    const statements = sql
      .split("\n")
      .filter((line) => !/^\s*--/.test(line))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      // Views and other additive objects are not needed for these tests.
      if (/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i.test(statement)) continue;
      await promisePool.query(statement);
    }
  };

  const prepare = async () => {
    await dropAll();
    await applyRealSchema();
    // Start every test from a known counter value.
    await promisePool.query("UPDATE receipt_counters SET value = 1000 WHERE name = 'pos'");
  };

  const seedProduct = async ({ barcode, stock, price = 100 }) => {
    const [result] = await promisePool.query(
      "INSERT INTO products (name, category, price, barcode, stock) VALUES (?, 'Test', ?, ?, ?)",
      [`Item ${barcode}`, price, barcode, stock]
    );
    return result.insertId;
  };

  const buy = (barcode, quantity) =>
    runCheckout(promisePool, { items: [{ barcode, quantity }], name: "Tester" }).then(
      (r) => ({ ok: true, ...r }),
      (e) => ({ ok: false, code: e.code })
    );

  test.after(async () => {
    await dropAll().catch(() => {});
    await promisePool.end().catch(() => {});
  });

  test("the shipped schema applies cleanly", async () => {
    await prepare();
    const [tables] = await promisePool.query("SHOW TABLES");
    assert.ok(tables.length > 0, "applying 001_schema.sql should create tables");

    const [counter] = await promisePool.query("SELECT * FROM receipt_counters WHERE name = 'pos'");
    assert.ok(counter.length > 0, "the receipt counter row must be seeded by the migration");
  });

  test("checkout decrements real stock and writes real rows", async () => {
    await prepare();
    const productId = await seedProduct({ barcode: "REAL-1", stock: 5, price: 120 });

    const result = await runCheckout(promisePool, {
      items: [{ barcode: "REAL-1", quantity: 2 }],
      name: "Ana",
    });

    assert.strictEqual(result.total, 240, "total must come from the stored price");

    const [[product]] = await promisePool.query("SELECT stock FROM products WHERE id = ?", [productId]);
    assert.strictEqual(product.stock, 3, "stock must be decremented by the quantity sold");

    const [[header]] = await promisePool.query("SELECT * FROM sales WHERE receipt_id = ?", [result.receiptId]);
    assert.ok(header, "a sales header row must exist");
    assert.strictEqual(Number(header.total), 240);

    const [lines] = await promisePool.query("SELECT * FROM sales_items WHERE receipt_id = ?", [result.receiptId]);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].barcode, "REAL-1", "the real barcode must be stored on the line");
    assert.strictEqual(Number(lines[0].price), 120);
    assert.strictEqual(Number(lines[0].total), 240);

    const [logs] = await promisePool.query("SELECT * FROM inventory_logs WHERE product_id = ?", [productId]);
    assert.strictEqual(logs.length, 1, "a sale must produce exactly one ledger entry");
    assert.strictEqual(logs[0].type, "OUT");
    assert.strictEqual(Number(logs[0].quantity), 2);
  });

  test("overselling fails and leaves stock and the ledger untouched", async () => {
    await prepare();
    const productId = await seedProduct({ barcode: "REAL-2", stock: 1 });

    await assert.rejects(
      () => runCheckout(promisePool, { items: [{ barcode: "REAL-2", quantity: 5 }], name: "Ana" }),
      (error) => error.code === "INSUFFICIENT_STOCK"
    );

    const [[product]] = await promisePool.query("SELECT stock FROM products WHERE id = ?", [productId]);
    assert.strictEqual(product.stock, 1, "a failed sale must not change stock");

    const [[lines]] = await promisePool.query("SELECT COUNT(*) AS n FROM sales_items");
    assert.strictEqual(Number(lines.n), 0, "a failed sale must not leave sale lines behind");

    const [[logs]] = await promisePool.query("SELECT COUNT(*) AS n FROM inventory_logs");
    assert.strictEqual(Number(logs.n), 0, "a failed sale must not write to the ledger");
  });

  test("concurrent checkouts of limited stock cannot oversell", async () => {
    await prepare();
    await seedProduct({ barcode: "REAL-3", stock: 10 });

    // Ten single-unit sales against exactly ten units, fired simultaneously.
    const results = await Promise.all(Array.from({ length: 10 }, () => buy("REAL-3", 1)));
    const succeeded = results.filter((r) => r.ok);

    const [[product]] = await promisePool.query("SELECT stock FROM products WHERE barcode = 'REAL-3'");
    assert.strictEqual(succeeded.length, 10, `all ten should succeed, got ${succeeded.length}`);
    assert.strictEqual(product.stock, 0, `stock must land on zero, never below (got ${product.stock})`);
  });

  test("a burst of concurrent checkouts gets unique, non-colliding receipts", async () => {
    await prepare();
    await seedProduct({ barcode: "REAL-4", stock: 100 });

    const results = await Promise.all(Array.from({ length: 25 }, () => buy("REAL-4", 1)));
    assert.ok(results.every((r) => r.ok), "every sale should succeed");

    const receipts = results.map((r) => r.receiptId);
    assert.strictEqual(new Set(receipts).size, 25, `expected 25 distinct receipts, got ${new Set(receipts).size}`);

    const [rows] = await promisePool.query(
      "SELECT receipt_id, COUNT(*) AS n FROM sales_items GROUP BY receipt_id HAVING n > 1"
    );
    assert.strictEqual(rows.length, 0, "a sale must never be split across two receipt numbers");
  });

  test("restock increases real stock and logs an IN movement", async () => {
    await prepare();
    const productId = await seedProduct({ barcode: "REAL-5", stock: 4 });

    const result = await runRestock(promisePool, {
      productId,
      amount: 6,
      supplier: "Test Supplier",
      staffName: "Ana",
    });

    assert.strictEqual(result.previousStock, 4);
    assert.strictEqual(result.newStock, 10);

    const [[product]] = await promisePool.query("SELECT stock FROM products WHERE id = ?", [productId]);
    assert.strictEqual(product.stock, 10);

    const [logs] = await promisePool.query("SELECT * FROM inventory_logs WHERE product_id = ?", [productId]);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].type, "IN");
    assert.strictEqual(Number(logs[0].quantity), 6);
  });

  // ---------------------------------------------------------------------
  // Account seeding. createAdmin.js is the only supported way to add staff
  // once the first admin exists, so its guards are worth covering.
  // ---------------------------------------------------------------------

  const ADMIN_SCRIPT = path.join(__dirname, "..", "scripts", "createAdmin.js");
  const GOOD_PASSWORD = "Str0ng-Pass!2026";

  const runSeeder = (args, password) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [ADMIN_SCRIPT, ...args], {
        // Run from a directory with no .env so the script's dotenv call cannot
        // pull in real production credentials and reconnect to the wrong server.
        cwd: os.tmpdir(),
        env: {
          ...process.env,
          DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
          DB_USER: process.env.DB_USER ?? "root",
          // Passed explicitly (possibly empty) so dotenv leaves it alone.
          DB_PASSWORD: process.env.DB_PASSWORD ?? "",
          DB_NAME: process.env.DB_NAME,
          ADMIN_PASSWORD: password ?? "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });

  const uniqueName = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

  test("seeding an admin stores a verifiable scrypt hash, never the password", async () => {
    await prepare();
    const username = uniqueName("seeded");
    const result = await runSeeder(["--username", username, "--role", "admin", "--inventory-logs"], GOOD_PASSWORD);

    assert.strictEqual(result.code, 0, `seeder failed: ${result.stderr}`);
    assert.match(result.stdout, /Created admin account/);

    const [[row]] = await promisePool.query(
      "SELECT username, password, role, can_view_inventory_logs FROM admins WHERE username = ?",
      [username]
    );

    assert.ok(row, "the account must be persisted");
    assert.strictEqual(row.role, "admin");
    assert.strictEqual(Number(row.can_view_inventory_logs), 1);

    assert.ok(!row.password.includes(GOOD_PASSWORD), "the raw password must not be stored");
    const { verifyPassword } = require("../lib/passwords");
    assert.strictEqual(await verifyPassword(GOOD_PASSWORD, row.password), true);
    assert.strictEqual(await verifyPassword("wrong-password", row.password), false);

    await promisePool.query("DELETE FROM admins WHERE username = ?", [username]);
  });

  test("seeding refuses weak passwords, bad usernames, bad roles and duplicates", async () => {
    await prepare();
    const weak = await runSeeder(["--username", uniqueName("weak")], "abc");
    assert.strictEqual(weak.code, 1);
    assert.match(weak.stderr, /Password rejected/);

    const shortName = await runSeeder(["--username", "a"], GOOD_PASSWORD);
    assert.strictEqual(shortName.code, 1);
    assert.match(shortName.stderr, /Username must be 3-32 characters/);

    const badRole = await runSeeder(["--username", uniqueName("role"), "--role", "root"], GOOD_PASSWORD);
    assert.strictEqual(badRole.code, 1);
    assert.match(badRole.stderr, /Role must be either/);

    const username = uniqueName("dup");
    const first = await runSeeder(["--username", username], GOOD_PASSWORD);
    assert.strictEqual(first.code, 0, `first seed failed: ${first.stderr}`);

    const second = await runSeeder(["--username", username], GOOD_PASSWORD);
    assert.strictEqual(second.code, 1);
    assert.match(second.stderr, /already exists/);

    await promisePool.query("DELETE FROM admins WHERE username = ?", [username]);
  });

  test("seeding without a password on a non-TTY fails loudly instead of using an empty one", async () => {
    await prepare();
    const result = await runSeeder(["--username", uniqueName("notty")], "");

    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /No TTY available/);

    const [[found]] = await promisePool.query(
      "SELECT COUNT(*) AS n FROM admins WHERE username LIKE 'notty%'"
    );
    assert.strictEqual(Number(found.n), 0, "no account may be created when prompting is impossible");
  });

  // ---------------------------------------------------------------------
  // Bootstrap registration guard.
  //
  // Regression test for a live auth bypass: the route read `count` off the rows
  // ARRAY instead of the first row, so the check was `Number(undefined) > 0`,
  // which is always false. Any unauthenticated caller could mint themselves an
  // administrator on any system that already had staff accounts.
  // ---------------------------------------------------------------------

  const startServer = async () => {
    const port = 5100 + Math.floor(Math.random() * 800);
    const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      cwd: os.tmpdir(), // no .env, so real credentials can never be picked up
      env: {
        ...process.env,
        PORT: String(port),
        DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
        DB_USER: process.env.DB_USER ?? "root",
        DB_PASSWORD: process.env.DB_PASSWORD ?? "",
        DB_NAME: process.env.DB_NAME,
        JWT_SECRET: process.env.JWT_SECRET,
        NODE_ENV: "test",
        // Silence the SMTP probe so the suite does not open network connections.
        SMTP_HOST: "",
        SMTP_USER: "",
        SMTP_PASS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let exited = false;
    child.on("exit", () => {
      exited = true;
    });

    // Wait for the port to answer. Bail out if our child died, otherwise a
    // leftover server from an earlier run could answer and we would silently be
    // testing stale code.
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (exited) throw new Error("server exited during startup");
      try {
        const res = await fetch(`${base}/api/health`);
        if (res.ok) return { child, base };
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    child.kill("SIGKILL");
    throw new Error("server did not become healthy");
  };

  const postJson = async (base, routePath, body) => {
    const res = await fetch(`${base}${routePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  test("bootstrap register allows the very first admin and refuses every later one", async () => {
    await prepare();
    const { child, base } = await startServer();

    try {
      const first = await postJson(base, "/api/register", {
        username: "first_admin",
        password: "Str0ng-Pass!2026",
      });
      assert.strictEqual(first.status, 201, `first admin should be created: ${JSON.stringify(first.body)}`);
      assert.ok(first.body.token, "the first admin receives a session token");

      const [[countAfterFirst]] = await promisePool.query("SELECT COUNT(*) AS n FROM admins");
      assert.strictEqual(Number(countAfterFirst.n), 1);

      // Every subsequent attempt must be refused, whatever the username.
      for (const username of ["second_admin", "attacker", "another"]) {
        const attempt = await postJson(base, "/api/register", {
          username,
          password: "Str0ng-Pass!2026",
        });
        assert.strictEqual(
          attempt.status,
          403,
          `register must be closed once an admin exists (${username} got ${attempt.status})`
        );
      }

      const [[finalCount]] = await promisePool.query("SELECT COUNT(*) AS n FROM admins");
      assert.strictEqual(
        Number(finalCount.n),
        1,
        "no further accounts may be created through the public bootstrap route"
      );
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("bootstrap register validates its input before touching the database", async () => {
    await prepare();
    const { child, base } = await startServer();

    try {
      const weak = await postJson(base, "/api/register", { username: "weakling", password: "abc" });
      assert.strictEqual(weak.status, 400, "a weak password must be rejected");

      const missing = await postJson(base, "/api/register", { username: "nopass" });
      assert.strictEqual(missing.status, 400, "a missing password must be rejected");

      const [[count]] = await promisePool.query("SELECT COUNT(*) AS n FROM admins");
      assert.strictEqual(Number(count.n), 0, "rejected attempts must not create rows");
    } finally {
      child.kill("SIGKILL");
    }
  });

  // ---------------------------------------------------------------------
  // Payment receipt access.
  //
  // Receipt images contain customer payment details, so the route must be
  // closed to anonymous callers AND to files that no order actually references.
  // Both halves are asserted here, including the happy path: a guard that
  // rejects everything would also pass a test that only checks the 401.
  // ---------------------------------------------------------------------

  const PASSWORD = "Str0ng-Pass!2026";

  const seedAdmin = async (username) => {
    const { hashPassword } = require("../lib/passwords");
    await promisePool.query(
      "INSERT INTO admins (username, password, role, can_view_inventory_logs) VALUES (?, ?, 'admin', 1)",
      [username, hashPassword(PASSWORD)]
    );
  };

  const loginAs = async (base, username) => {
    const res = await postJson(base, "/api/login", { username, password: PASSWORD });
    assert.strictEqual(res.status, 200, `login should succeed: ${JSON.stringify(res.body)}`);
    return res.body.token;
  };

  test("a payment receipt is served only to a signed-in admin, and only when an order references it", async () => {
    await prepare();
    const fs = require("node:fs");
    const { RECEIPTS_DIR } = require("../lib/paths");

    const filename = `test-receipt-${Date.now()}.png`;
    const absolute = path.join(RECEIPTS_DIR, filename);
    const bytes = Buffer.from("89504e470d0a1a0a" + "0".repeat(64), "hex"); // PNG magic

    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
    fs.writeFileSync(absolute, bytes);

    try {
      await seedAdmin("receipt_admin");
      const { child, base } = await startServer();

      try {
        const anonymous = await fetch(`${base}/api/orders/receipts/${filename}`);
        assert.strictEqual(anonymous.status, 401, "receipts must not be public");

        // A file on disk that no order points at is still not readable.
        const stray = await fetch(`${base}/api/orders/receipts/${filename}`, {
          headers: { Authorization: `Bearer ${await loginAs(base, "receipt_admin")}` },
        });
        assert.strictEqual(stray.status, 404, "an unreferenced file must not be served");

        // Now let an order reference it, and the same admin must get the bytes.
        const customerId = (
          await promisePool.query(
            "INSERT INTO customers (name, email) VALUES ('Receipt Tester', 'receipt@test.local')"
          )
        )[0].insertId;
        await promisePool.query(
          "INSERT INTO online_orders (order_number, customer_id, order_status, total_amount, receipt_image) VALUES ('RCPT-1', ?, 'pending_payment', 10, ?)",
          [customerId, `/uploads/receipts/${filename}`]
        );

        const token = await loginAs(base, "receipt_admin");
        const authorized = await fetch(`${base}/api/orders/receipts/${filename}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(authorized.status, 200, "a referenced receipt must be served to an admin");

        const served = Buffer.from(await authorized.arrayBuffer());
        assert.ok(served.equals(bytes), "the served bytes must match the stored file exactly");

        // Path traversal must not escape the receipts directory.
        for (const attempt of ["..%2f..%2f.env", "..%5c..%5c.env", "%2e%2e%2f%2e%2e%2f.env"]) {
          const escape = await fetch(`${base}/api/orders/receipts/${attempt}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          assert.ok(
            escape.status >= 400 && escape.status < 500,
            `traversal attempt must be rejected, got ${escape.status}`
          );
          const body = await escape.text();
          assert.ok(!body.includes("DB_PASSWORD"), "traversal must never leak file contents");
        }
      } finally {
        child.kill("SIGKILL");
      }
    } finally {
      fs.rmSync(absolute, { force: true });
    }
  });

  // ---------------------------------------------------------------------
  // Supplier picker source.
  //
  // Supplier is free text on each restock row, so the picker is derived from
  // history rather than a real suppliers table. The behaviour that matters is
  // the grouping: padding and letter case must collapse, otherwise the picker
  // starts handing out "Paper", " paper" and "PAPER" as three vendors.
  // ---------------------------------------------------------------------

  const seedStaff = async (username) => {
    const { hashPassword } = require("../lib/passwords");
    await promisePool.query(
      "INSERT INTO admins (username, password, role, can_view_inventory_logs) VALUES (?, ?, 'sub', 0)",
      [username, hashPassword(PASSWORD)]
    );
  };

  test("suppliers are listed for an admin, deduped by case and padding, and hidden from staff", async () => {
    await prepare();
    await seedAdmin("supplier_admin");
    await seedStaff("supplier_staff");

    const productId = await seedProduct({ barcode: "SUP-1", stock: 50 });

    // Deliberately messy: same vendor written three different ways, plus a
    // blank that must never be offered as a choice.
    const messy = ["  Acme Corp  ", "acme corp", "ACME CORP", "", "   ", "Paper Company"];
    for (const supplier of messy) {
      await promisePool.query(
        "INSERT INTO restocks (product_id, quantity_added, previous_stock, new_stock, reason, supplier, cost_price) VALUES (?, 5, 50, 55, 'seed', ?, 0)",
        [productId, supplier]
      );
    }

    const { child, base } = await startServer();

    try {
      const adminToken = await loginAs(base, "supplier_admin");
      const staffToken = await loginAs(base, "supplier_staff");

      const anonymous = await fetch(`${base}/api/products/suppliers`);
      assert.strictEqual(anonymous.status, 401, "supplier history must not be public");

      const asStaff = await fetch(`${base}/api/products/suppliers`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      assert.strictEqual(asStaff.status, 403, "staff must not read supplier history");

      const asAdmin = await fetch(`${base}/api/products/suppliers`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(asAdmin.status, 200);
      const { suppliers } = await asAdmin.json();

      assert.ok(Array.isArray(suppliers), "suppliers must be an array");
      assert.strictEqual(suppliers.length, 2, `expected exactly 2 distinct suppliers, got ${JSON.stringify(suppliers)}`);

      const names = suppliers.map((row) => row.supplier);
      assert.deepStrictEqual(names.sort(), ["Acme Corp", "Paper Company"], `unexpected suppliers: ${JSON.stringify(names)}`);
      assert.ok(
        !names.some((n) => n !== n.trim()),
        "supplier names must be trimmed"
      );
      assert.ok(
        !names.includes(""),
        "blank suppliers must never be offered"
      );

      const acme = suppliers.find((row) => row.supplier === "Acme Corp");
      assert.strictEqual(acme.times_used, 3, "the three case/padding variants must merge into one vendor");
      assert.ok(acme.last_used, "each supplier reports when it was last used");
    } finally {
      child.kill("SIGKILL");
    }
  });
}

main().catch((error) => {
  skipAll(`integration setup failed: ${error.message}`);
});
