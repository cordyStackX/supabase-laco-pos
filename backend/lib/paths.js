"use strict";

const path = require("path");

/**
 * Single source of truth for upload locations.
 *
 * UPLOAD_DIR can be pointed at a mounted volume in production (Docker, or a
 * separate data disk) without touching code. It defaults to <backend>/uploads.
 *
 * Layout:
 *   <UPLOAD_DIR>/            product images, served publicly at /uploads
 *   <UPLOAD_DIR>/receipts/   customer payment receipts, NEVER public
 */
const UPLOADS_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "..", "uploads");

const RECEIPTS_DIR = path.join(UPLOADS_DIR, "receipts");

/**
 * Resolves a client-supplied filename inside a directory and refuses anything
 * that escapes it, whether via traversal, an absolute path, or a symlinked
 * parent. Returns null when the result would be unsafe.
 */
function safeJoin(dir, filename) {
  if (typeof filename !== "string" || filename.length === 0) return null;
  // Only plain filenames are ever expected here.
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) return null;
  if (filename === "." || filename === "..") return null;

  const resolved = path.resolve(dir, filename);
  if (path.dirname(resolved) !== path.resolve(dir)) return null;
  return resolved;
}

module.exports = { UPLOADS_DIR, RECEIPTS_DIR, safeJoin };
