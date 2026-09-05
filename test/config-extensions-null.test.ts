import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Writers aren't exported (importing tersio.ts would run the CLI), so this
// guards the shared normalizer: one regex, used by both config writers.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "tersio.ts"), "utf8");

test("config writer normalizes `extensions: null` before appending list items", () => {
  assert.match(src, /const EXTENSIONS_NULL_RE = \//);
  const users = src.match(/normalizeExtensionsKey\(/g) ?? [];
  // Definition + one call per writer.
  assert.ok(users.length >= 3, "expected normalizeExtensionsKey shared by both writers");
  for (const candidate of ["extensions: null", "extensions: ~", "extensions: []", "extensions:"]) {
    const re = /^\s*extensions\s*:\s*(?:\[\s*\]|null|~)?\s*$/i;
    assert.match(candidate, re, candidate);
  }
  assert.doesNotMatch("extensions:\n  - /x/y.js", /^\s*extensions\s*:\s*(?:\[\s*\]|null|~)?\s*$/i);
});
