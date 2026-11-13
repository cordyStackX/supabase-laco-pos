"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { UPLOADS_DIR, RECEIPTS_DIR, safeJoin } = require("../lib/paths");

test("upload paths are derived from a single source of truth", () => {
  assert.ok(path.isAbsolute(UPLOADS_DIR), "UPLOADS_DIR must be absolute");
  assert.equal(RECEIPTS_DIR, path.join(UPLOADS_DIR, "receipts"));
});

test("safeJoin accepts a plain filename inside the directory", () => {
  const target = safeJoin(UPLOADS_DIR, "book-1.jpg");
  assert.equal(target, path.join(UPLOADS_DIR, "book-1.jpg"));
});

test("safeJoin refuses traversal, absolute paths and separators", () => {
  const attempts = [
    "../secret",
    "..",
    ".",
    "../../etc/passwd",
    "receipts/../../etc/passwd",
    "sub/dir.jpg",
    "..\\..\\windows\\system32",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "file with spaces.jpg",
    "bad;name.jpg",
    "",
    null,
    undefined,
    123,
  ];

  for (const attempt of attempts) {
    assert.equal(
      safeJoin(UPLOADS_DIR, attempt),
      null,
      `should have rejected: ${JSON.stringify(attempt)}`
    );
  }
});

test("safeJoin rejects names that normalise out of the directory", () => {
  // These are plain-looking but resolve outside when joined.
  for (const attempt of ["..%2f..%2fetc", "....//etc/passwd", "..", ".", "a/../.."]) {
    assert.equal(safeJoin(UPLOADS_DIR, attempt), null, `should have rejected: ${attempt}`);
  }
});
