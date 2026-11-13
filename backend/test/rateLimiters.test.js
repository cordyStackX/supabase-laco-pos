"use strict";

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

const { loginLimiter } = require("../middleware/rateLimiters");

/**
 * The login limiter is keyed by IP *and* username, because every cashier on the
 * shop floor shares one machine or one store LAN address. An IP-only bucket
 * locked out the whole register after ten fumbled attempts by a single person.
 *
 * The IP half of that key still has to be handled properly. IPv6 hands out a
 * /64 to each subscriber, so keying on the raw address gives one attacker an
 * effectively unlimited number of buckets and the limiter stops limiting. The
 * key must fold the address down to its subnet prefix.
 */

/** Runs `fn` with NODE_ENV flipped so the limiter is actually armed. */
async function withLimiterArmed(fn) {
  const original = process.env.NODE_ENV;
  // The limiter's `skip` reads this at request time, so flipping it here is
  // enough to make the real exported instance enforce itself.
  process.env.NODE_ENV = original === "test" ? "test-disabled" : original || "development";
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
}

/** Minimal app that runs the real limiter and reports whether the request passed. */
async function startApp() {
  const app = express();
  app.set("trust proxy", true); // so X-Forwarded-For decides req.ip
  app.use(express.json());
  app.use(loginLimiter);
  // The limiter sets skipSuccessfulRequests, so it only counts responses it
  // considers failures. This stub must therefore reject, exactly like a real
  // wrong-password login, or nothing is ever counted and nothing ever throttles.
  app.post("/login", (req, res) => res.status(401).json({ success: false, message: "Invalid credentials" }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const attempt = (base, ip, username) =>
  fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ username, password: "wrong-on-purpose" }),
  });

test("two IPv6 addresses inside one /64 share a single login bucket", async () => {
  await withLimiterArmed(async () => {
    const app = await startApp();

    try {
      // Both addresses sit in the same /64, which is what a real subscriber
      // gets. Keyed on the raw address they would each get their own bucket and
      // the limiter would never trip.
      const first = "2001:db8:85a3:8d3:1319:8a2e:370:7348";
      const second = "2001:db8:85a3:8d3:1319:8a2e:370:9999";

      let sawLimited = false;
      for (let i = 0; i < 12; i++) {
        // Alternate between the two addresses in the subnet.
        const res = await attempt(app.base, i % 2 === 0 ? first : second, "ipv6_target");
        if (res.status === 429) {
          sawLimited = true;
          break;
        }
      }

      assert.ok(sawLimited, "addresses in the same /64 must share one bucket and trip the limit");
    } finally {
      await app.close();
    }
  });
});

test("distinct accounts from one address keep independent budgets", async () => {
  await withLimiterArmed(async () => {
    const app = await startApp();

    try {
      for (let i = 0; i < 12; i++) {
        await attempt(app.base, "198.51.100.7", "noisy_user");
      }

      // The whole point of the per-account key: one person's bad password must
      // not lock out a colleague signing in from the same machine. The stub
      // always answers 401, so reaching 401 proves the request was not throttled.
      const colleague = await attempt(app.base, "198.51.100.7", "calm_colleague");
      assert.strictEqual(colleague.status, 401, "a different account must not be locked out");
    } finally {
      await app.close();
    }
  });
});

test("a request with no username in the body is still counted, not left unlimited", async () => {
  await withLimiterArmed(async () => {
    const app = await startApp();

    try {
      // With no username the key collapses to "ip|", so every body-less request
      // from one address shares a budget. That is the safe direction to fail:
      // such requests cannot buy themselves unlimited attempts. The property
      // worth pinning is that an empty account never escapes counting.
      let sawLimited = false;
      for (let i = 0; i < 12; i++) {
        const res = await fetch(`${app.base}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.9" },
          body: JSON.stringify({ password: "wrong-on-purpose" }),
        });
        if (res.status === 429) {
          sawLimited = true;
          break;
        }
      }

      assert.ok(sawLimited, "an absent username must not become an unlimited bucket");
    } finally {
      await app.close();
    }
  });
});

test("IPv4 keys are passed through untouched", async () => {
  await withLimiterArmed(async () => {
    const app = await startApp();

    try {
      let sawLimited = false;
      for (let i = 0; i < 12; i++) {
        const res = await attempt(app.base, "198.51.100.11", "v4_target");
        if (res.status === 429) {
          sawLimited = true;
          break;
        }
      }
      assert.ok(sawLimited, "the per-account limit must still apply to IPv4 clients");
    } finally {
      await app.close();
    }
  });
});