"use strict";

/**
 * Password storage and the legacy-plaintext migration.
 *
 * This project originally stored staff passwords in cleartext. When hashing was
 * introduced, every existing account became unloginable, because the new
 * verifier only understood hash formats. These tests pin the migration path:
 * a cleartext account must still authenticate and must be flagged for upgrade.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  hashPassword,
  verifyPassword,
  needsRehash,
  isPlaintextPassword,
} = require("../lib/passwords");

test("a cleartext password still authenticates", () => {
  // These are the real shapes found in the staff table.
  assert.strictEqual(verifyPassword("john", "john"), true, "michael/john must log in");
  assert.strictEqual(verifyPassword("RIN2088", "RIN2088"), true, "RIN must log in");
  assert.strictEqual(verifyPassword("RED0999", "RED0999"), true, "RED must log in");
});

test("a cleartext account rejects the wrong password", () => {
  assert.strictEqual(verifyPassword("wrong", "john"), false);
  assert.strictEqual(verifyPassword("john", "wrong"), false);
  assert.strictEqual(verifyPassword("", "john"), false);
  // Case must still matter.
  assert.strictEqual(verifyPassword("rin2088", "RIN2088"), false);
});

test("cleartext accounts are detected and flagged for upgrade", () => {
  assert.strictEqual(isPlaintextPassword("john"), true);
  assert.strictEqual(needsRehash("john"), true, "a cleartext password must be upgraded on next login");
});

test("a password containing : or $ is still treated as cleartext, not a hash", () => {
  // These must not be misparsed as a legacy "salt:key" or scrypt string.
  for (const password of ["a:b", "a:b:c", "pa$$word", "user:name", "$ecret", "x:y$z"]) {
    assert.strictEqual(isPlaintextPassword(password), true, `${password} must be seen as cleartext`);
    assert.strictEqual(verifyPassword(password, password), true, `${password} must authenticate`);
  }
});

test("scrypt hashes authenticate and are not flagged for rehash", () => {
  const stored = hashPassword("Str0ng-Pass!2026");
  assert.strictEqual(isPlaintextPassword(stored), false);
  assert.strictEqual(needsRehash(stored), false, "a current hash must not be rewritten on every login");
  assert.strictEqual(verifyPassword("Str0ng-Pass!2026", stored), true);
  assert.strictEqual(verifyPassword("Str0ng-Pass!2027", stored), false);
});

test("each hash uses a fresh salt", () => {
  const a = hashPassword("same-password-123");
  const b = hashPassword("same-password-123");
  assert.notStrictEqual(a, b, "identical passwords must not produce identical hashes");
  assert.strictEqual(verifyPassword("same-password-123", a), true);
  assert.strictEqual(verifyPassword("same-password-123", b), true);
});

test("malformed stored values never authenticate", () => {
  for (const stored of ["", "scrypt$131072$8$1$zz$zz", "scrypt$a$b$c$d$e", null, undefined, 12345]) {
    assert.strictEqual(verifyPassword("anything", stored), false, `${String(stored)} must not authenticate`);
  }
});
