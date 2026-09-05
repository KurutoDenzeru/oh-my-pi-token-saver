import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

test("doctor reports MISSING components against an empty home", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(process.execPath, [installer, "doctor"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
  });

  assert.equal(result.status, 0, result.stderr);
  for (const line of ["OMP extensions dir: MISSING", "Shared session bridge: MISSING", "Caveman extension: MISSING", "RTK extension: MISSING", "Combo extension: MISSING", "RTK binary: MISSING"]) {
    assert.match(result.stdout, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // Categorized output: section headers plus a closing tally.
  for (const section of ["Environment", "Installation", "Extensions", "Plugins", "RTK"]) {
    assert.match(result.stdout, new RegExp(`\\n${section}\\n`));
  }
  assert.match(result.stdout, /Summary: \d+ checks — \d+ ok, \d+ warn, \d+ missing/);
});
