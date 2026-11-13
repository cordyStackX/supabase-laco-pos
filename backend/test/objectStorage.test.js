"use strict";

const test = require("node:test");
const assert = require("node:assert");

const originalEnv = {
  UPLOAD_STORAGE: process.env.UPLOAD_STORAGE,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_PRODUCT_BUCKET: process.env.SUPABASE_PRODUCT_BUCKET,
  SUPABASE_RECEIPT_BUCKET: process.env.SUPABASE_RECEIPT_BUCKET,
};

process.env.UPLOAD_STORAGE = "supabase";
process.env.SUPABASE_URL = "https://project.example";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test-key";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_PRODUCT_BUCKET = "product-images";
process.env.SUPABASE_RECEIPT_BUCKET = "payment-receipts";

const {
  getProductPublicUrl,
  readReceipt,
  removeUpload,
  saveUpload,
} = require("../lib/objectStorage");

const originalFetch = global.fetch;

test.after(() => {
  global.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("stores product images in the public bucket while receipts use a private path", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options, headers: new Headers(options.headers) });
    return Response.json({ Key: "test-object" });
  };

  const image = await saveUpload(
    { buffer: Buffer.from("image"), mimetype: "image/png" },
    { kind: "product", filename: "book.png" }
  );
  const receipt = await saveUpload(
    { buffer: Buffer.from("receipt"), mimetype: "image/jpeg" },
    { kind: "receipt", filename: "receipt-1.jpg" }
  );

  assert.strictEqual(
    image.relativePath,
    "https://project.example/storage/v1/object/public/product-images/products/book.png"
  );
  assert.strictEqual(receipt.relativePath, "/uploads/receipts/receipt-1.jpg");
  assert.match(calls[0].url, /\/object\/product-images\/products\/book\.png$/);
  assert.match(calls[1].url, /\/object\/payment-receipts\/receipt-1\.jpg$/);
  assert.strictEqual(calls[1].headers.get("content-type"), "image/jpeg");
  assert.strictEqual(calls[0].headers.get("apikey"), "sb_secret_test-key");
});

test("reads receipts through private storage and removes product objects by owned public URL", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options, headers: new Headers(options.headers) });
    if (options.method === "GET") {
      return new Response(Buffer.from("private receipt"), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    return Response.json([]);
  };

  const receipt = await readReceipt("receipt-2.jpg");
  assert.strictEqual(receipt.buffer.toString(), "private receipt");
  assert.strictEqual(receipt.contentType, "image/jpeg");
  assert.match(calls[0].url, /\/object\/payment-receipts\/receipt-2\.jpg$/);

  const productUrl = getProductPublicUrl("book.png");
  await removeUpload(productUrl, "product");
  assert.strictEqual(calls[1].options.method, "DELETE");
  assert.deepStrictEqual(JSON.parse(calls[1].options.body), { prefixes: ["products/book.png"] });
});
