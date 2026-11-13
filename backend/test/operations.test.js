"use strict";

/**
 * Checkout, restock and payment verification.
 *
 * These drive real money, so the tests focus on the properties that matter:
 * stock cannot go negative, receipt numbers cannot repeat, a failed operation
 * leaves no partial writes, and replaying a request cannot double-apply it.
 *
 * A fake connection records the SQL it is given and replays canned results, so
 * these run with no database. A real-DB integration suite lives in
 * integration.test.js and skips itself when MySQL is unreachable.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  runCheckout,
  runRestock,
  verifyEcomPayment,
  generatePickupCode,
  OperationError,
} = require("../lib/operations");

/**
 * Minimal stand-in for a mysql2 connection.
 *
 * `handlers` maps a substring of the SQL to a result. `calls` records every
 * query for assertions. Unknown queries return an empty result set, which is
 * what a real driver does for a query with no matching row.
 *
 * Results must be shaped like the real driver returns them: `[rows, fields]`
 * for a SELECT and `[ResultSetHeader, undefined]` for an INSERT/UPDATE.
 */
function fakePool(connection) {
  return { getConnection: async () => connection };
}

/** Uses the real query flow by routing each call through the handler map. */
function routedPool(handlers) {
  const calls = [];
  const paramsLog = [];
  const connection = {
    calls,
    paramsLog,
    beginTransaction: async () => calls.push("-- BEGIN"),
    commit: async () => calls.push("-- COMMIT"),
    rollback: async () => calls.push("-- ROLLBACK"),
    release: () => {},
    query: async (sql, params = []) => {
      calls.push(sql);
      paramsLog.push({ sql, params });
      for (const [pattern, result] of Object.entries(handlers)) {
        if (sql.includes(pattern)) {
          return typeof result === "function" ? result(sql, params, calls) : result;
        }
      }
      return [[], []];
    },
  };
  return { pool: fakePool(connection), calls, paramsLog, connection };
}

const productRow = (overrides = {}) => ({
  id: 1,
  name: "Dictionario",
  price: 150,
  stock: 10,
  barcode: "BC-1",
  ...overrides,
});

// ===================== normaliseItems / validation =====================

test("checkout rejects an empty cart", async () => {
  const { pool } = routedPool({});
  await assert.rejects(
    () => runCheckout(pool, { items: [] }),
    (error) => error instanceof OperationError && error.code === "EMPTY_CART"
  );
});

test("checkout rejects a line with no barcode", async () => {
  const { pool } = routedPool({});
  await assert.rejects(
    () => runCheckout(pool, { items: [{ quantity: 1 }] }),
    (error) => error.code === "INVALID_ITEM"
  );
});

test("checkout rejects a non-positive or fractional quantity", async () => {
  const { pool } = routedPool({});
  for (const quantity of [0, -3, 1.5, "abc"]) {
    await assert.rejects(
      () => runCheckout(pool, { items: [{ barcode: "BC-1", quantity }] }),
      (error) => error.code === "INVALID_ITEM",
      `quantity ${quantity} should be rejected`
    );
  }
});

// ===================== receipt allocation =====================

test("checkout allocates the receipt number from the counter, not MAX(receipt_id)+1", async () => {
  const { pool, calls } = routedPool({
    "UPDATE receipt_counters": [{ affectedRows: 1 }, undefined],
    "SELECT LAST_INSERT_ID": [[{ receipt_id: 1001 }]],
    "FROM products WHERE barcode": [[productRow()]],
  });

  const result = await runCheckout(pool, { items: [{ barcode: "BC-1", quantity: 1 }], name: "Ana" });

  assert.strictEqual(result.receiptId, 1001);
  assert.ok(
    calls.some((c) => c.includes("UPDATE receipt_counters SET value = LAST_INSERT_ID(value + 1)")),
    "must use the atomic counter increment"
  );
  assert.ok(
    !calls.some((c) => /MAX\s*\(\s*receipt_id/i.test(c)),
    "must not use the race-prone MAX(receipt_id) + 1 pattern"
  );
});

test("checkout fails loudly when the receipt counter is not initialised", async () => {
  const { pool } = routedPool({
    "UPDATE receipt_counters": [{ affectedRows: 0 }, undefined],
    "FROM products WHERE barcode": [[productRow()]],
  });

  await assert.rejects(
    () => runCheckout(pool, { items: [{ barcode: "BC-1", quantity: 1 }] }),
    (error) => error.code === "COUNTER_MISSING" && /migrations/.test(error.message)
  );
});

// ===================== stock integrity =====================

test("checkout locks the product row before reading its stock", async () => {
  const { pool, calls } = routedPool({
    "UPDATE receipt_counters": [{ affectedRows: 1 }, undefined],
    "SELECT LAST_INSERT_ID": [[{ receipt_id: 1001 }]],
    "FROM products WHERE barcode": [[productRow()]],
  });

  await runCheckout(pool, { items: [{ barcode: "BC-1", quantity: 1 }], name: "Ana" });

  const select = calls.find((c) => c.includes("FROM products WHERE barcode"));
  assert.ok(select, "expected a product lookup");
  assert.ok(/FOR UPDATE/.test(select), `product row must be locked, got: ${select}`);
});

test("checkout refuses to oversell and rolls the whole sale back", async () => {
  const { pool, calls } = routedPool({
    "UPDATE receipt_counters": [{ affectedRows: 1 }, undefined],
    "SELECT LAST_INSERT_ID": [[{ receipt_id: 1001 }]],
    "FROM products WHERE barcode": [[productRow({ stock: 2 })]],
  });

  await assert.rejects(
    () => runCheckout(pool, { items: [{ barcode: "BC-1", quantity: 5 }] }),
    (error) => error instanceof OperationError && error.status === 409 && error.code === "INSUFFICIENT_STOCK"
  );

  assert.ok(calls.includes("-- ROLLBACK"), "the transaction must be rolled back");
  assert.ok(!calls.includes("-- COMMIT"), "nothing may be committed");
  assert.ok(
    !calls.some((c) => c.startsWith("INSERT INTO sales_items")),
    "no sale line may be written when the sale fails"
  );
});

test("checkout rejects an unknown barcode", async () => {
  const { pool } = routedPool({
    "UPDATE receipt_counters": [{ affectedRows: 1 }, undefined],
    "SELECT LAST_INSERT_ID": [[{ receipt_id: 1001 }]],
    "FROM products WHERE barcode": [[]],
  });

  await assert.rejects(
    () => runCheckout(pool, { items: [{ barcode: "NOPE", quantity: 1 }] }),
    (error) => error.code === "PRODUCT_NOT_FOUND"
  );
});

test("checkout writes the product barcode onto the sale line", async () => {
  const { pool, calls } = routedPool({
    "UPDATE receipt_counters": [{ affectedRows: 1 }, undefined],
    "SELECT LAST_INSERT_ID": [[{ receipt_id: 1001 }]],
    "FROM products WHERE barcode": [[productRow()]],
  });

  await runCheckout(pool, { items: [{ barcode: "BC-1", quantity: 2 }], name: "Ana" });

  const insert = calls.find((c) => c.includes("INSERT INTO sales_items"));
  assert.ok(insert, "expected a sale line insert");
  // The barcode is a bound parameter, so assert the query reads it from the
  // product row rather than hard-coding it.
  assert.ok(insert.includes("(product_id, barcode, quantity"), insert);
});

test("checkout writes an OUT ledger entry for every line", async () => {
  const { pool, calls } = routedPool({
    "UPDATE receipt_counters": [{ affectedRows: 1 }, undefined],
    "SELECT LAST_INSERT_ID": [[{ receipt_id: 1001 }]],
    "FROM products WHERE barcode": [[productRow()]],
  });

  await runCheckout(pool, { items: [{ barcode: "BC-1", quantity: 3 }], name: "Ana" });

  const ledger = calls.filter((c) => c.includes("INSERT INTO inventory_logs"));
  assert.strictEqual(ledger.length, 1);
  assert.ok(ledger[0].includes("'OUT'"), "sale must be logged as stock OUT");
});

test("a checkout of two different products commits both lines", async () => {
  const { pool, calls } = routedPool({
    "UPDATE receipt_counters": [{ affectedRows: 1 }, undefined],
    "SELECT LAST_INSERT_ID": [[{ receipt_id: 1001 }]],
    // The barcode is a bound parameter, so match on the params, not the SQL.
    "FROM products WHERE barcode": (_sql, params) => [
      [
        params[0] === "A"
          ? productRow({ id: 1, barcode: "A", name: "Book A", price: 100 })
          : productRow({ id: 2, barcode: "B", name: "Book B", price: 250 }),
      ],
    ],
  });

  const result = await runCheckout(pool, {
    items: [
      { barcode: "A", quantity: 1 },
      { barcode: "B", quantity: 2 },
    ],
    name: "Ana",
  });

  assert.strictEqual(result.total, 100 + 250 * 2);
  assert.strictEqual(calls.filter((c) => c.includes("INSERT INTO sales_items")).length, 2);
  assert.ok(calls.includes("-- COMMIT"));
});

test("checkout totals and stock movements use the server's price, not a client-supplied one", async () => {
  const { pool, paramsLog } = routedPool({
    "UPDATE receipt_counters": [{ affectedRows: 1 }, undefined],
    "SELECT LAST_INSERT_ID": [[{ receipt_id: 1001 }]],
    "FROM products WHERE barcode": [[productRow({ price: 150, stock: 10 })]],
  });

  // A tampered client payload claiming a price of 1 must not be honoured.
  const result = await runCheckout(pool, {
    items: [{ barcode: "BC-1", quantity: 2, price: 1, total: 2 }],
    name: "Ana",
  });

  assert.strictEqual(result.total, 300, "total must come from the database price");

  // sales_items columns: product_id, barcode, quantity, price, total, product_name, receipt_id
  const line = paramsLog.find((q) => q.sql.includes("INSERT INTO sales_items"));
  assert.ok(line, "expected a sale line insert");
  assert.strictEqual(line.params[2], 2, "quantity comes from the request");
  assert.strictEqual(line.params[3], 150, "price must be the database price, not the client's 1");
  assert.strictEqual(line.params[4], 300, "line total is price x quantity");

  const stockUpdate = paramsLog.find((q) => q.sql.includes("UPDATE products SET stock = stock -"));
  assert.ok(stockUpdate, "stock must be decremented");
  assert.strictEqual(stockUpdate.params[0], 2, "decrement must use the requested quantity");
});

// ===================== restock =====================

test("restock rejects a non-positive amount", async () => {
  const { pool } = routedPool({ "SELECT stock, name": [[{ stock: 5, name: "Book" }]] });

  for (const amount of [0, -1, 2.5, "x"]) {
    await assert.rejects(
      () => runRestock(pool, { productId: 1, amount, supplier: "Supplier", staffName: "Ana" }),
      (error) => error instanceof OperationError,
      `amount ${amount} should be rejected`
    );
  }
});

test("restock rejects an unknown product", async () => {
  const { pool } = routedPool({ "SELECT stock, name": [[]] });
  await assert.rejects(
    () => runRestock(pool, { productId: 999, amount: 5, supplier: "Supplier", staffName: "Ana" }),
    (error) => /not found/i.test(error.message)
  );
});

test("restock locks the row, raises stock and records an IN ledger entry", async () => {
  const { pool, calls } = routedPool({ "SELECT stock, name": [[{ stock: 5, name: "Book" }]] });

  const result = await runRestock(pool, {
    productId: 1,
    amount: 3,
    supplier: "Nationwide",
    staffName: "Ana",
  });

  assert.strictEqual(result.previousStock, 5);
  assert.strictEqual(result.newStock, 8);

  const select = calls.find((c) => c.includes("SELECT stock, name"));
  assert.ok(/FOR UPDATE/.test(select), `restock must lock the product row, got: ${select}`);
  assert.ok(calls.some((c) => c.includes("UPDATE products SET stock =")), "stock must be updated");
  assert.ok(
    calls.some((c) => c.includes("INSERT INTO inventory_logs") && c.includes("'IN'")),
    "restock must be logged as stock IN"
  );
});

// ===================== e-commerce payment verification =====================

test("payment verification is rejected when the order is already verified", async () => {
  const { pool } = routedPool({
    "FROM ecom_orders WHERE id": [[{ id: 5, status: "Payment Verified", payment_status: "verified" }]],
  });

  await assert.rejects(
    () => verifyEcomPayment(pool, { orderId: 5, verifiedBy: 1 }),
    (error) => error.code === "ALREADY_VERIFIED",
    "re-verifying must not issue a second pickup code"
  );
});

test("payment verification rejects an unknown order", async () => {
  const { pool } = routedPool({ "FROM ecom_orders WHERE id": [[]] });
  await assert.rejects(
    () => verifyEcomPayment(pool, { orderId: 404, verifiedBy: 1 }),
    (error) => error.code === "ORDER_NOT_FOUND"
  );
});

test("payment verification locks the order row before deciding", async () => {
  const { pool, calls } = routedPool({ "FROM ecom_orders WHERE id": [[]] });

  await verifyEcomPayment(pool, { orderId: 404, verifiedBy: 1 }).catch(() => {});

  const select = calls.find((c) => c.includes("FROM ecom_orders WHERE id"));
  assert.ok(/FOR UPDATE/.test(select), `order row must be locked, got: ${select}`);
});

test("payment verification issues a pickup code and marks the order verified", async () => {
  const { pool, calls } = routedPool({
    "FROM ecom_orders WHERE id": [[{ id: 5, status: "Pending", payment_status: "pending" }]],
    "SELECT id FROM ecom_orders WHERE pickup_code": [[]],
  });

  const result = await verifyEcomPayment(pool, { orderId: 5, verifiedBy: 1, staffName: "Ana" });

  assert.match(result.pickupCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.ok(
    calls.some((c) => c.includes("SET payment_status = 'verified'")),
    "order must be marked verified"
  );
  assert.ok(
    calls.some((c) => c.includes("UPDATE ecom_payments SET status = 'verified'")),
    "the payment record must be marked verified too"
  );
});

test("payment verification rejects a non-numeric order id", async () => {
  const { pool } = routedPool({});
  for (const orderId of ["abc", 0, -1, 1.5]) {
    await assert.rejects(
      () => verifyEcomPayment(pool, { orderId, verifiedBy: 1 }),
      (error) => error.code === "INVALID_ORDER",
      `orderId ${orderId} should be rejected`
    );
  }
});

// ===================== pickup codes =====================

test("pickup codes use only unambiguous characters", () => {
  for (let i = 0; i < 500; i += 1) {
    assert.match(generatePickupCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

test("pickup codes are not all identical across many draws", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(generatePickupCode());
  assert.ok(seen.size > 190, `expected a wide spread, got ${seen.size} distinct codes from 200 draws`);
});

// ===================== transaction plumbing =====================

test("a failure inside the transaction triggers a rollback, not a commit", async () => {
  const calls = [];
  const connection = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes("UPDATE receipt_counters")) return [{ affectedRows: 1 }, undefined];
      if (sql.includes("SELECT LAST_INSERT_ID")) return [[{ receipt_id: 7 }]];
      if (sql.includes("FROM products WHERE barcode")) return [[productRow()]];
      return [[], []];
    },
    beginTransaction: async () => calls.push("-- BEGIN"),
    commit: async () => calls.push("-- COMMIT"),
    rollback: async () => calls.push("-- ROLLBACK"),
    release: () => {},
  };

  // Force a failure after the stock update by making the ledger insert explode.
  const original = connection.query;
  connection.query = async (sql) => {
    if (sql.includes("INSERT INTO inventory_logs")) throw new Error("disk full");
    return original(sql);
  };

  await assert.rejects(
    () => runCheckout(fakePool(connection), { items: [{ barcode: "BC-1", quantity: 1 }], name: "Ana" }),
    /disk full/
  );

  assert.ok(calls.includes("-- ROLLBACK"));
  assert.ok(!calls.includes("-- COMMIT"));
});
