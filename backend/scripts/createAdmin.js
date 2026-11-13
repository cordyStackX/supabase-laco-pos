"use strict";

/**
 * Creates a staff account from the command line.
 *
 * Two ways to supply the password, in order of preference:
 *   ADMIN_PASSWORD=... npm run seed:admin -- --username admin --role admin
 *   npm run seed:admin -- --username admin --role sub      (prompts, no echo)
 *
 * This exists because the HTTP /api/register route is only reachable while the
 * admins table is empty. On a system that already has an admin, and on servers
 * where the POS UI is not exposed, this script is the way in.
 */

require("dotenv").config();

const readline = require("readline");
const { promisePool } = require("../db");
const { hashPassword, validatePasswordStrength } = require("../lib/passwords");

const args = process.argv.slice(2);

const USAGE =
  "Usage: npm run seed:admin -- --username <name> [--role admin|sub] [--inventory-logs]";

function flag(name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

/**
 * Reads a line with terminal echo disabled so the password never reaches the
 * screen or the scrollback buffer.
 *
 * Keypress events are consumed straight off stdin. A readline Interface is
 * deliberately NOT used: with `terminal: true` it echoes every character
 * itself, which would print the password even in raw mode.
 */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("No TTY available. Set ADMIN_PASSWORD instead of being prompted."));
      return;
    }

    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let answer = "";

    const finish = (fn, value) => {
      process.stdin.removeListener("keypress", onKeypress);
      if (wasRaw === false) process.stdin.setRawMode(false);
      process.stdin.pause();
      fn(value);
    };

    function onKeypress(str, key = {}) {
      if (key.ctrl && key.name === "c") {
        finish(reject, new Error("Aborted."));
        return;
      }
      if (key.ctrl && key.name === "d" && answer.length === 0) {
        finish(reject, new Error("Aborted."));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        process.stdout.write("\n");
        finish(resolve, answer);
        return;
      }
      if (key.name === "backspace") {
        answer = answer.slice(0, -1);
        return;
      }
      // Drop escape sequences, arrows, and other multi-byte control input.
      if (key.ctrl || key.meta || typeof str !== "string") return;
      if (str.length === 1) answer += str;
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", onKeypress);
    process.stdout.write(question);
  });
}

async function main() {
  const username = (flag("username") || "").trim();
  const role = (flag("role") || "admin").trim().toLowerCase();
  const withInventoryAccess = args.includes("--inventory-logs");

  if (!username) {
    console.error(USAGE);
    process.exit(1);
  }

  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    console.error("Username must be 3-32 characters using letters, digits, dot, underscore or hyphen.");
    process.exit(1);
  }

  if (!["admin", "sub"].includes(role)) {
    console.error("Role must be either 'admin' or 'sub'.");
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askHidden("Password: ");
    const confirm = await askHidden("Confirm password: ");
    if (password !== confirm) {
      console.error("Passwords do not match.");
      process.exit(1);
    }
  }

  // Returns an error string, or null when the password is acceptable.
  const strengthProblem = validatePasswordStrength(password);
  if (strengthProblem) {
    console.error(`Password rejected: ${strengthProblem}`);
    process.exit(1);
  }

  const [existing] = await promisePool.query("SELECT id FROM admins WHERE username = ?", [username]);
  if (existing.length > 0) {
    console.error(`An account named "${username}" already exists. Use Manage Staff or a password reset instead.`);
    process.exit(1);
  }

  await promisePool.query(
    "INSERT INTO admins (username, password, role, can_view_inventory_logs) VALUES (?, ?, ?, ?)",
    [username, await hashPassword(password), role, withInventoryAccess ? 1 : 0]
  );

  console.log(`Created ${role} account "${username}".`);
}

main()
  .then(
    () => {
      process.exitCode = 0;
    },
    (error) => {
      console.error(`Failed: ${error.message}`);
      process.exitCode = 1;
    }
  )
  // Close the pool before exiting, otherwise process.exit() would cut the
  // connection off mid-teardown.
  .finally(() => promisePool.end())
  .then(() => {
    // Exit explicitly: raw-mode terminal input can otherwise keep the event
    // loop alive after the work is done.
    process.stdin.pause();
    process.exit(process.exitCode ?? 0);
  });
