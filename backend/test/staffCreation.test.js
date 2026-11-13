"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-value-that-is-long-enough-32";

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

const { signToken, AUDIENCES } = require("../lib/tokens");
const { promisePool } = require("../db");
const authRoutes = require("../routes/authRoutes");

const originalQuery = promisePool.query.bind(promisePool);

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", authRoutes);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  return server;
}

test("admin can create only sub-admin staff accounts", async () => {
  let insertCalled = false;
  promisePool.query = async (sql) => {
    if (/SELECT id, username, role, can_view_inventory_logs FROM admins WHERE id = \?/.test(sql)) {
      return [[{ id: 1, username: "root", role: "admin", can_view_inventory_logs: 1 }]];
    }

    if (/INSERT INTO admins/.test(sql)) {
      insertCalled = true;
      return [{ insertId: 99 }];
    }

    return [[]];
  };

  const server = await startApp();
  const port = server.address().port;
  const token = signToken({ sub: "1", role: "admin" }, AUDIENCES.POS);

  try {
    const adminRoleResponse = await fetch(`http://127.0.0.1:${port}/api/admin/staff`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "new-admin",
        password: "Str0ng-Pass!2026",
        role: "admin",
      }),
    });

    const adminRoleJson = await adminRoleResponse.json();
    assert.strictEqual(adminRoleResponse.status, 400, `expected 400 for admin role, got ${adminRoleResponse.status}: ${JSON.stringify(adminRoleJson)}`);
    assert.strictEqual(insertCalled, false, "admin role should be rejected before inserting a record");

    const subAdminResponse = await fetch(`http://127.0.0.1:${port}/api/admin/staff`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "new-sub-admin",
        password: "Str0ng-Pass!2026",
        role: "sub",
        canViewInventoryLogs: true,
      }),
    });

    const subAdminJson = await subAdminResponse.json();
    assert.strictEqual(subAdminResponse.status, 201, `expected 201 for sub-admin role, got ${subAdminResponse.status}: ${JSON.stringify(subAdminJson)}`);
    assert.strictEqual(subAdminJson.staff.role, "sub");
  } finally {
    server.close();
    promisePool.query = originalQuery;
  }
});
