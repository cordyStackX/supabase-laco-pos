"use strict";

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const AUDIENCES = { POS: "pos", ECOM: "ecom" };

const ALG = "HS256";

/**
 * Fallback lifetimes when the environment does not override them. POS staff
 * sessions are short because a terminal is a shared, supervised surface;
 * customer sessions are longer for shopping carts and checkouts.
 */
const DEFAULT_EXPIRY = {
  [AUDIENCES.POS]: "12h",
  [AUDIENCES.ECOM]: "7d",
};

/**
 * Per-audience override, e.g. JWT_EXPIRES_IN_POS=8h / JWT_EXPIRES_IN_ECOM=14d.
 * Values are passed to jsonwebtoken, which validates and rejects malformed
 * durations (e.g. "forever") when the token is signed.
 */
function expiryFor(audience) {
  const specific = process.env[`JWT_EXPIRES_IN_${audience.toUpperCase()}`];
  if (specific) return specific;
  const shared = process.env.JWT_EXPIRES_IN;
  if (shared) return shared;
  return DEFAULT_EXPIRY[audience] || "1d";
}

let cachedSecret = null;

function getSecret() {
  if (cachedSecret) return cachedSecret;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET is missing or shorter than 32 characters. " +
        "Set a strong random value in the environment before starting the server."
    );
  }
  cachedSecret = secret;
  return cachedSecret;
}

/** Test seam: lets the suite inject a secret without touching process.env. */
function setSecret(secret) {
  cachedSecret = secret;
}

function signToken(payload, audience, expiresIn) {
  return jwt.sign({ ...payload, aud: audience }, getSecret(), {
    algorithm: ALG,
    expiresIn: expiresIn || expiryFor(audience),
  });
}

/**
 * Verifies signature, expiry and audience. Returns the payload or null.
 * The audience is mandatory: a POS staff token must never be accepted on a
 * customer route (or vice versa), even though both live in the same app.
 */
function verifyToken(token, audience) {
  if (!token || typeof token !== "string") return null;
  try {
    const payload = jwt.verify(token, getSecret(), {
      algorithms: [ALG],
      ...(audience ? { audience } : {}),
    });
    return payload;
  } catch {
    return null;
  }
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
}

/** Cryptographically random, URL-safe id. */
const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString("hex");

module.exports = {
  AUDIENCES,
  getSecret,
  signToken,
  verifyToken,
  bearerToken,
  setSecret,
  randomId,
};
