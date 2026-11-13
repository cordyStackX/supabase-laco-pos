"use strict";

/**
 * POS staff authentication and authorization.
 *
 * The key property: the role always comes from the database, never from the
 * token, and never from a client-supplied header. A staff member cannot reach
 * an admin route by editing their token or setting a header.
 *
 * The database is stubbed by replacing `promisePool.query` on the shared pool
 * object, so these tests need no MySQL server.
 */

const test = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-value-that-is-long-enough-32";

// Register a fake ../db in the require cache *before* staffAuth is loaded, so
// the middleware never opens a real MySQL connection. Overwriting the cache
// entry is the seam; production code is untouched.
const promisePool = {
  query: async () => [[], []],
  end: async () => {},
};

const dbPath = require.resolve("../db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { promisePool, config: {}, getConnection: async () => ({ release() {} }) },
};

const { signToken, setSecret } = require("../lib/tokens");
const {
  authenticateStaff,
  requireRole,
  requireAdmin,
  requireInventoryLogAccess,
} = require("../middleware/staffAuth");

setSecret("test-secret-value-that-is-long-enough-32");

const realQuery = promisePool.query.bind(promisePool);

/** Replaces the DB lookup for the duration of one test. */
function withStaffRow(row, assertion) {
  promisePool.query = async () => (row === null ? [[], []] : [[row], []]);
  return Promise.resolve(assertion()).finally(() => {
    promisePool.query = realQuery;
  });
}

/** Minimal req/res triple that records what the middleware did. */
function makeExchange(authorization) {
  const req = { headers: authorization ? { authorization } : {} };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };
  return { req, res, next, wasNextCalled: () => nextCalled };
}

const adminRow = { id: 1, username: "root", role: "admin", can_view_inventory_logs: 1 };
const subRow = { id: 2, username: "clerk", role: "sub", can_view_inventory_logs: 0 };
const subWithLogs = { id: 3, username: "clerk2", role: "sub", can_view_inventory_logs: 1 };

const posToken = (sub, role = "admin") => signToken({ sub, role }, "pos");

test("rejects a request with no Authorization header", async () => {
  await withStaffRow(adminRow, async () => {
    const { req, res, next, wasNextCalled } = makeExchange(null);
    await authenticateStaff(req, res, next);

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(wasNextCalled(), false);
  });
});

test("rejects a non-bearer scheme", async () => {
  await withStaffRow(adminRow, async () => {
    const { req, res, wasNextCalled } = makeExchange("Basic YWRtaW46YWRtaW4=");
    await authenticateStaff(req, res, () => {});

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(wasNextCalled(), false);
  });
});

test("rejects a garbage or tampered token", async () => {
  await withStaffRow(adminRow, async () => {
    for (const token of ["abc", "a.b.c", posToken(1).slice(0, -3) + "xxx"]) {
      const { req, res } = makeExchange(`Bearer ${token}`);
      await authenticateStaff(req, res, () => {});
      assert.strictEqual(res.statusCode, 401, `token ${token.slice(0, 12)} should be rejected`);
    }
  });
});

test("rejects an e-commerce customer token on a staff route", async () => {
  await withStaffRow(adminRow, async () => {
    const customerToken = signToken({ sub: "77" }, "ecom");
    const { req, res, wasNextCalled } = makeExchange(`Bearer ${customerToken}`);
    await authenticateStaff(req, res, () => {});

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(wasNextCalled(), false);
  });
});

test("rejects a valid token whose account has since been deleted", async () => {
  await withStaffRow(null, async () => {
    const { req, res } = makeExchange(`Bearer ${posToken(999)}`);
    await authenticateStaff(req, res, () => {});

    assert.strictEqual(res.statusCode, 401);
    assert.match(res.body.message, /no longer exists/i);
  });
});

test("accepts a valid token and populates req.staff from the database", async () => {
  await withStaffRow(subRow, async () => {
    const { req, res, next, wasNextCalled } = makeExchange(`Bearer ${posToken(2)}`);
    await authenticateStaff(req, res, next);

    assert.strictEqual(wasNextCalled(), true);
    assert.deepStrictEqual(req.staff, {
      id: 2,
      username: "clerk",
      role: "sub",
      canViewInventoryLogs: false,
    });
  });
});

test("ignores the role claimed inside the token and uses the stored role", async () => {
  // The token claims admin; the account is a plain staff member.
  await withStaffRow(subRow, async () => {
    const { req, res, next } = makeExchange(`Bearer ${posToken(2, "admin")}`);
    await authenticateStaff(req, res, next);

    assert.strictEqual(req.staff.role, "sub", "role must come from the database, not the token");
  });
});

test("a role change takes effect on the next request, without re-issuing the token", async () => {
  const token = posToken(2);

  await withStaffRow(subRow, async () => {
    const first = makeExchange(`Bearer ${token}`);
    await authenticateStaff(first.req, first.res, first.next);
    assert.strictEqual(first.req.staff.role, "sub");
  });

  await withStaffRow({ ...subRow, role: "admin" }, async () => {
    const second = makeExchange(`Bearer ${token}`);
    await authenticateStaff(second.req, second.res, second.next);
    assert.strictEqual(second.req.staff.role, "admin", "promotion must apply immediately");
  });
});

test("a database error surfaces as a 500, not as a bypass", async () => {
  promisePool.query = async () => {
    throw new Error("connection lost");
  };
  try {
    const { req, res, wasNextCalled } = makeExchange(`Bearer ${posToken(1)}`);
    await authenticateStaff(req, res, () => {});

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(wasNextCalled(), false, "must not pass the request through on error");
  } finally {
    promisePool.query = realQuery;
  }
});

// ===================== authorization =====================

test("requireAdmin allows an admin", () => {
  const { req, res, next, wasNextCalled } = makeExchange(null);
  req.staff = { id: 1, role: "admin" };
  requireAdmin(req, res, next);
  assert.strictEqual(wasNextCalled(), true);
});

test("requireAdmin blocks a staff member", () => {
  const { req, res, next, wasNextCalled } = makeExchange(null);
  req.staff = { id: 2, role: "sub" };
  requireAdmin(req, res, next);

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(wasNextCalled(), false);
});

test("requireAdmin blocks an unauthenticated request", () => {
  const { req, res, next, wasNextCalled } = makeExchange(null);
  requireAdmin(req, res, next);

  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(wasNextCalled(), false);
});

test("requireRole allows only the listed roles", () => {
  const check = requireRole("sub");

  const allowed = makeExchange(null);
  allowed.req.staff = { role: "sub" };
  check(allowed.req, allowed.res, allowed.next);
  assert.strictEqual(allowed.wasNextCalled(), true);

  const denied = makeExchange(null);
  denied.req.staff = { role: "admin" };
  check(denied.req, denied.res, denied.next);
  assert.strictEqual(denied.res.statusCode, 403);
});

test("inventory logs are visible to an admin", () => {
  const { req, res, next, wasNextCalled } = makeExchange(null);
  req.staff = { role: "admin", canViewInventoryLogs: false };
  requireInventoryLogAccess(req, res, next);
  assert.strictEqual(wasNextCalled(), true);
});

test("inventory logs are visible to staff with the explicit grant", () => {
  const { req, res, next, wasNextCalled } = makeExchange(null);
  req.staff = { role: "sub", canViewInventoryLogs: true };
  requireInventoryLogAccess(req, res, next);
  assert.strictEqual(wasNextCalled(), true);
});

test("inventory logs are hidden from staff without the grant", () => {
  const { req, res, next, wasNextCalled } = makeExchange(null);
  req.staff = { role: "sub", canViewInventoryLogs: false };
  requireInventoryLogAccess(req, res, next);

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(wasNextCalled(), false);
});

test("a staff member cannot escalate by setting an x-user-role header", async () => {
  await withStaffRow(subRow, async () => {
    const { req, res, next, wasNextCalled } = makeExchange(`Bearer ${posToken(2)}`);
    // The client claims to be an admin.
    req.headers["x-user-role"] = "admin";

    await authenticateStaff(req, res, next);

    assert.strictEqual(wasNextCalled(), true);
    assert.strictEqual(req.staff.role, "sub", "the header must have no effect");

    // ...and the admin-only route still refuses.
    const denied = makeExchange(null);
    requireAdmin({ staff: req.staff }, denied.res, denied.next);
    assert.strictEqual(denied.res.statusCode, 403);
  });
});
