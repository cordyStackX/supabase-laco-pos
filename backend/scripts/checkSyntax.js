"use strict";

/**
 * Parses every source file in the backend so a syntax error cannot reach a
 * deployment. Exits non-zero and lists the offending files on failure.
 *
 * This is intentionally not a linter; it is a fast, dependency-free gate that
 * works the same on a developer machine and in CI.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "uploads"]);
const SOURCE_EXT = new Set([".js", ".cjs", ".mjs"]);

function collect(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(path.join(dir, entry.name), found);
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

const files = collect(ROOT);
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    const detail = (error.stderr ? error.stderr.toString() : error.message)
      .split("\n")
      .filter((line) => line.trim() && !/^\s*at /.test(line))
      .slice(0, 4)
      .join("\n      ");
    failures.push({ file: path.relative(ROOT, file), detail });
  }
}

if (failures.length > 0) {
  console.error(`Syntax check failed in ${failures.length} of ${files.length} files:\n`);
  for (const { file, detail } of failures) {
    console.error(`  ${file}\n      ${detail}\n`);
  }
  process.exit(1);
}

console.log(`Syntax OK: ${files.length} files parsed.`);
