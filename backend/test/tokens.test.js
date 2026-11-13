"use strict";

/**
 * Token issuing and verification, in particular the audience separation that
 * stops a POS staff token being replayed against customer routes (and the
 * reverse), since both live in the same process and share one secret.
 */

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-value-that-is-long-enough-32";

const { AUDIENCES, signToken, verifyToken, bearerToken, setSecret } = require("../lib/tokens");

const SECRET = "test-secret-value-that-is-long-enough-32";
setSecret(SECRET);

test("refuses to issue a token when JWT_SECRET is missing or too short", () => {
  // Run in a child process: getSecret caches, so the guard cannot be
  // re-entered in-process without disturbing the other tests.
  const script = 'require(process.argv[1]).signToken({ sub: "1" }, "pos")';
  const modulePath = path.join(__dirname, "..", "lib", "tokens.js");

  for (const secret of ["", "short", "x".repeat(31)]) {
    assert.throws(
      () =>
        execFileSync(process.execPath, ["-e", script, modulePath], {
          env: { ...process.env, JWT_SECRET: secret },
          stdio: "pipe",
        }),
      // Node hard-wraps the error across lines, so normalise whitespace before
      // looking for the reason.
      (error) => /JWT_SECRET is missing or shorter than 32 characters/.test(String(error.stderr).replace(/\s+/g, " ")),
      `secret length ${secret.length} should be rejected`
    );
  }
});

test("signs and verifies a POS token", () => {
  const token = signToken({ sub: "7", role: "admin" }, AUDIENCES.POS);
  const payload = verifyToken(token, AUDIENCES.POS);
  assert.strictEqual(payload.sub, "7");
  assert.strictEqual(payload.role, "admin");
  assert.strictEqual(payload.aud, AUDIENCES.POS);
});

test("a POS token is rejected on the e-commerce audience", () => {
  const token = signToken({ sub: "7", role: "admin" }, AUDIENCES.POS);
  assert.strictEqual(verifyToken(token, AUDIENCES.ECOM), null);
});

test("an e-commerce token is rejected on the POS audience", () => {
  const token = signToken({ sub: "42" }, AUDIENCES.ECOM);
  assert.strictEqual(verifyToken(token, AUDIENCES.POS), null);
});

test("rejects a token signed with a different secret", () => {
  setSecret("a-completely-different-secret-of-length-32");
  const foreign = signToken({ sub: "1", role: "admin" }, AUDIENCES.POS);

  setSecret(SECRET);
  assert.strictEqual(verifyToken(foreign, AUDIENCES.POS), null);
});

test("rejects an unsigned (alg=none) token", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ sub: "1", role: "admin", aud: AUDIENCES.POS })
  ).toString("base64url");

  assert.strictEqual(verifyToken(`${header}.${body}.`, AUDIENCES.POS), null);
});

test("rejects a token whose payload was tampered with", () => {
  const token = signToken({ sub: "1", role: "sub" }, AUDIENCES.POS);
  const [header, , signature] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ sub: "1", role: "admin", aud: AUDIENCES.POS })
  ).toString("base64url");

  assert.strictEqual(verifyToken(`${header}.${forged}.${signature}`, AUDIENCES.POS), null);
});

test("rejects an expired token", () => {
  const token = signToken({ sub: "1", role: "admin" }, AUDIENCES.POS, "-1s");
  assert.strictEqual(verifyToken(token, AUDIENCES.POS), null);
});

test("verifyToken returns null rather than throwing on garbage input", () => {
  for (const bad of [null, undefined, "", "not-a-jwt", "a.b.c", 12345, {}]) {
    assert.strictEqual(verifyToken(bad, AUDIENCES.POS), null, `input: ${String(bad)}`);
  }
});

test("reads a bearer token from the Authorization header", () => {
  assert.strictEqual(bearerToken({ headers: { authorization: "Bearer abc.def.ghi" } }), "abc.def.ghi");
  assert.strictEqual(bearerToken({ headers: { authorization: "bearer abc" } }), "abc", "scheme is case-insensitive");
});

test("ignores missing or malformed Authorization headers", () => {
  for (const headers of [
    {},
    { authorization: "" },
    { authorization: "Bearer" },
    { authorization: "Basic abc" },
    { authorization: "abc" },
    { authorization: 42 },
  ]) {
    assert.strictEqual(bearerToken({ headers }), null, JSON.stringify(headers));
  }
});
