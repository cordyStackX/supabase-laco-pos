"use strict";

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const { promisePool } = require("../db");
const { RECEIPTS_DIR, UPLOADS_DIR, safeJoin } = require("../lib/paths");
const { saveUpload } = require("../lib/objectStorage");

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function uploadLegacyFile(directory, filename, kind) {
  if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename === "." || filename === "..") {
    throw new Error(`Invalid legacy ${kind} filename`);
  }
  const source = safeJoin(directory, filename);
  if (!source) throw new Error(`Unsafe legacy ${kind} path`);

  let buffer;
  try {
    buffer = await fs.readFile(source);
  } catch (error) {
    if (error.code === "ENOENT") {
      error.message = `Missing local ${kind} file ${filename}; restore it before deploying`;
    }
    throw error;
  }

  const contentType = CONTENT_TYPES[path.extname(filename).toLowerCase()];
  if (!contentType) throw new Error(`Unsupported legacy ${kind} file extension: ${filename}`);
  const stored = await saveUpload({ buffer, mimetype: contentType }, { kind, filename });
  return stored.relativePath;
}

async function main() {
  if (process.env.DB_CLIENT?.toLowerCase() !== "postgres") {
    throw new Error("Set DB_CLIENT=postgres: this script updates products after uploading their files.");
  }
  if (process.argv.includes("--confirm-storage-migration") !== true) {
    throw new Error("Refusing to upload legacy files without --confirm-storage-migration.");
  }
  const skipMissingProducts = process.argv.includes("--skip-missing-products");

  const [products] = await promisePool.query(
    "SELECT id, image FROM products WHERE image LIKE '/uploads/%'"
  );
  const [receipts] = await promisePool.query(`
    SELECT receipt_image FROM online_orders WHERE receipt_image LIKE '/uploads/receipts/%'
    UNION SELECT receipt_image FROM order_payments WHERE receipt_image LIKE '/uploads/receipts/%'
    UNION SELECT receipt_image FROM ecom_orders WHERE receipt_image LIKE '/uploads/receipts/%'
    UNION SELECT receipt_image FROM ecom_payments WHERE receipt_image LIKE '/uploads/receipts/%'
  `);

  let imagesUploaded = 0;
  const skippedProducts = [];
  const uploadedReceipts = new Set();

  for (const product of products) {
    const filename = path.basename(product.image);
    let publicUrl;
    try {
      publicUrl = await uploadLegacyFile(UPLOADS_DIR, filename, "product");
    } catch (error) {
      if (skipMissingProducts && error.code === "ENOENT") {
        skippedProducts.push({ id: product.id, filename });
        continue;
      }
      throw error;
    }
    await promisePool.query("UPDATE products SET image = ? WHERE id = ?", [publicUrl, product.id]);
    imagesUploaded += 1;
  }

  for (const receipt of receipts) {
    const filename = path.basename(receipt.receipt_image);
    if (uploadedReceipts.has(filename)) continue;
    await uploadLegacyFile(RECEIPTS_DIR, filename, "receipt");
    uploadedReceipts.add(filename);
  }

  console.log(`Uploaded ${imagesUploaded} product image(s) and ${uploadedReceipts.size} private receipt(s).`);
  if (skippedProducts.length > 0) {
    console.warn(
      `Skipped ${skippedProducts.length} product image(s) with missing local files: ` +
        skippedProducts.map(({ id, filename }) => `${id}:${filename}`).join(", ")
    );
    console.warn("These product records still reference their original /uploads paths.");
  }
  console.log("Receipt database paths were preserved and remain available only through the authenticated API.");
}

main()
  .catch((error) => {
    console.error(`Legacy upload transfer failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => promisePool.end());
