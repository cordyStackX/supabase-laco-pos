"use strict";

/**
 * Converts plaintext POS admin passwords into scrypt hashes.
 *
 * Accounts that are already hashed (`salt:key` or `scrypt$...`) are left
 * untouched, so this is safe to run more than once. An empty password is
 * converted to a hash that no input can match, which closes the account
 * without guessing a replacement.
 */

const { hashPassword } = require("../lib/passwords");

async function up(pool) {
  const [rows] = await pool.query("SELECT id, username, password FROM admins");

  let converted = 0;
  let alreadyHashed = 0;
  let emptied = 0;

  for (const row of rows) {
    const stored = row.password;

    // A stored value containing ':' or starting with 'scrypt$' is already a hash.
    const looksHashed =
      typeof stored === "string" && (stored.startsWith("scrypt$") || stored.includes(":"));

    if (looksHashed) {
      alreadyHashed += 1;
      continue;
    }

    if (!stored) {
      await pool.query("UPDATE admins SET password = ? WHERE id = ?", [
        hashPassword(`disabled-${Math.random().toString(36).slice(2)}`),
        row.id,
      ]);
      emptied += 1;
      console.log(`   disabled account with empty password: ${row.username}`);
      continue;
    }

    await pool.query("UPDATE admins SET password = ? WHERE id = ?", [hashPassword(stored), row.id]);
    converted += 1;
    console.log(`   hashed password for: ${row.username}`);
  }

  console.log(
    `   ${converted} converted, ${alreadyHashed} already hashed, ${emptied} disabled (empty password)`
  );
}

module.exports = { up };
