"use strict";

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-value-that-is-long-enough-32";

const staffPassword = "Test-password-2026!";
const { hashPassword } = require("../lib/passwords");
const adminRow = {
  id: 1,
  username: "admin",
  password: hashPassword(staffPassword),
  role: "admin",
  can_view_inventory_logs: 1,
};

const promisePool = {
  async query(sql) {
    if (sql.startsWith("SELECT id, username, password, role, can_view_inventory_logs")) {
      return [[adminRow], []];
    }
    return [{ affectedRows: 1 }, []];
  },
};

const dbPath = require.resolve("../db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { promisePool, config: {}, getConnection: async () => ({ release() {} }) },
};

const { setSecret } = require("../lib/tokens");
setSecret("test-secret-value-that-is-long-enough-32");
const authRoutes = require("../routes/authRoutes");

test("login accepts admin and sub account types while rejecting invalid or mismatched types", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", authRoutes);
  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/login`;

  const login = (role) =>
    fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: adminRow.username, password: staffPassword, role }),
    });

  try {
    const adminLogin = await login("admin");
    assert.strictEqual(adminLogin.status, 200);
    assert.strictEqual((await adminLogin.json()).user.role, "admin");

    const invalidType = await login("customer");
    assert.strictEqual(invalidType.status, 400);
    assert.strictEqual((await invalidType.json()).message, "Invalid account type");

    const mismatchedType = await login("sub");
    assert.strictEqual(mismatchedType.status, 403);
    assert.strictEqual(
      (await mismatchedType.json()).message,
      "This account does not match the selected account type"
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
