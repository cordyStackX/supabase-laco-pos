"use strict";

const crypto = require("crypto");

const KEY_LEN = 64;
const SALT_LEN = 16;

// OWASP-recommended scrypt work factors (N = 2^17, r = 8, p = 1).
const DEFAULTS = { N: 2 ** 17, r: 8, p: 1 };

// scrypt needs roughly 128 * N * r bytes, which is 128 MB at the defaults
// above. Node's maxmem has to cover that plus overhead, otherwise every hash
// and verify throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS and nobody can log in.
const memFor = (N, r) => 128 * N * r * 2;

// Cost of one hash at the default work factor. Used to reject logins that
// would take an attacker unreasonably long to brute force offline.
const COST_UNITS = DEFAULTS.N * DEFAULTS.r * DEFAULTS.p;

const derive = (password, salt, N, r, p) =>
  crypto.scryptSync(password, salt, KEY_LEN, { N, r, p, maxmem: memFor(N, r) });

function hashPassword(password, opts = {}) {
  const N = opts.N || DEFAULTS.N;
  const r = opts.r || DEFAULTS.r;
  const p = opts.p || DEFAULTS.p;
  const salt = crypto.randomBytes(SALT_LEN).toString("hex");
  const key = derive(password, salt, N, r, p);
  return ["scrypt", N, r, p, salt, key.toString("hex")].join("$");
}

const isHexOfLength = (value, bytes) =>
  typeof value === "string" && value.length === bytes * 2 && /^[0-9a-f]+$/i.test(value);

/**
 * Encoded formats we understand:
 *   "scrypt$N$r$p$saltHex$keyHex"  current
 *   "saltHex:keyHex"              legacy (pre-security-fix accounts, no cost params)
 *
 * Anything that does not match one of those signatures exactly is treated as a
 * cleartext password, because this project originally stored staff passwords
 * unhashed. The hex/length checks matter: a cleartext password that happens to
 * contain ":" or "$" would otherwise be misread as a hash and lock the account
 * out permanently.
 */
function parseHash(stored) {
  if (typeof stored !== "string" || !stored) return null;

  if (stored.includes("$")) {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return null;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = parts[4];
    const key = parts[5];
    if (![N, r, p].every((v) => Number.isInteger(v) && v > 0)) return null;
    if (!isHexOfLength(salt, SALT_LEN) || !isHexOfLength(key, KEY_LEN)) return null;

    return { N, r, p, salt, key, legacy: false };
  }

  const parts = stored.split(":");
  if (parts.length !== 2) return null;

  const [salt, key] = parts;
  if (!isHexOfLength(salt, SALT_LEN) || !isHexOfLength(key, KEY_LEN)) return null;

  return { N: 16384, r: 8, p: 1, salt, key, legacy: true };
}

/** True when the stored value is a raw, unhashed password. */
function isPlaintextPassword(stored) {
  return typeof stored === "string" && stored.length > 0 && parseHash(stored) === null;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyPassword(password, stored) {
  if (typeof password !== "string" || !password) return false;

  // Legacy cleartext accounts. They keep working and are rehashed to scrypt by
  // the caller on their next successful login.
  if (isPlaintextPassword(stored)) {
    return safeEqual(password, stored);
  }

  const parsed = parseHash(stored);
  if (!parsed) return false;

  let expected;
  try {
    expected = Buffer.from(parsed.key, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LEN) return false;

  let actual;
  try {
    actual = derive(password, parsed.salt, parsed.N, parsed.r, parsed.p);
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** True when a stored hash uses weaker parameters than we now use. */
function needsRehash(stored) {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N * parsed.r * parsed.p < COST_UNITS;
}

const PASSWORD_MIN_LENGTH = 8;

function validatePasswordStrength(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  needsRehash,
  isPlaintextPassword,
  validatePasswordStrength,
  PASSWORD_MIN_LENGTH,
};
