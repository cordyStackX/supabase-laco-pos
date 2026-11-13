"use strict";

const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const json = (message) => ({ success: false, message });

const shared = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Tests and local development should not trip the limiter.
  skip: () => process.env.NODE_ENV === "test",
};

/**
 * Credential endpoints.
 *
 * Keyed by IP *and* username. An IP-only key is wrong for this application:
 * every cashier on the shop floor logs in from the same machine or the same
 * store LAN address, so a single IP-only bucket is shared by all staff. Ten
 * fumbled attempts by one person locked out everyone else for 15 minutes.
 * Keying by account keeps brute force against any one account bounded while
 * letting different staff log in independently.
 */
const loginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  // Count only failures so a busy register or a cashier with the wrong role
  // selected is not locked out after a handful of attempts.
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // A missing body during the pre-auth window yields an empty account, so
    // those requests share the "ip|" bucket. That fails safe: they are counted
    // against one budget instead of escaping the limiter entirely.
    const raw = req.body && (req.body.username ?? req.body.email);
    const account = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    // ipKeyGenerator folds IPv6 addresses to their subnet prefix. A raw
    // req.ip would give every IPv6 client a distinct bucket from the same
    // device, since the /64 prefix is attacker-controlled.
    return `${ipKeyGenerator(req.ip)}|${account}`;
  },
  message: json("Too many failed attempts for this account. Please wait a few minutes and try again."),
});

/**
 * Broad brute-force backstop across many usernames from one address. Paired with
 * the per-account limiter above, so spraying many accounts from a single IP is
 * still capped even though each account gets its own budget.
 */
const loginSweepLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 50,
  skipSuccessfulRequests: true,
  message: json("Too many login attempts from this device. Please wait a few minutes and try again."),
});

/** OTP issuance and verification. */
const otpLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: json("Too many requests. Please wait and try again."),
});

const otpVerifyLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: json("Too many verification attempts. Please request a new code."),
});

/** Customer account creation. */
const registerLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: json("Too many accounts created from this address. Please try again later."),
});

/** File uploads. Caps disk growth from payment receipts and product images. */
const uploadLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 120,
  message: json("Upload limit reached. Please try again later."),
});

/** Broad backstop for everything else. */
const apiLimiter = rateLimit({
  ...shared,
  skip: () => process.env.NODE_ENV !== "production",
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  message: json("Rate limit exceeded. Please slow down."),
});

module.exports = {
  loginLimiter,
  loginSweepLimiter,
  otpLimiter,
  otpVerifyLimiter,
  registerLimiter,
  uploadLimiter,
  apiLimiter,
};
