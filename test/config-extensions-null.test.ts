import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ponytail: writer fns aren't exported, so this guards the normalization
// regex instead of driving install (needs network/HOME). Upgrade path:
// export ensureExtensionInConfig and test it against a temp config.yml.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "tersio.ts"), "utf8");

test("config writer normalizes `extensions: null` before appending list items", () => {
  const matches = src.match(/extensions\\s\*:\\s\*\(\?:.*?\)\?\\s\*/g) ?? [];
  assert.ok(matches.length >= 2, "expected null/~/[] normalization in both writers");
  for (const candidate of ["extensions: null", "extensions: ~", "extensions: []", "extensions:"]) {
    const re = /^\s*extensions\s*:\s*(?:\[\s*\]|null|~)?\s*$/i;
    assert.match(candidate, re, candidate);
  }
  assert.doesNotMatch("extensions:\n  - /x/y.js", /^\s*extensions\s*:\s*(?:\[\s*\]|null|~)?\s*$/i);
});
