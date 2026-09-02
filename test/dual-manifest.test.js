import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const extensionPaths = [...manifest.omp.extensions, ...manifest.pi.extensions];

test("declares discoverable OMP and Pi Amanai reward extensions", () => {
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.deepEqual(manifest.omp.extensions, ["./extensions/amanai-reward/index.js"]);
  assert.deepEqual(manifest.pi.extensions, ["./extensions/amanai-reward/pi.js"]);

  for (const path of extensionPaths) {
    assert.ok(existsSync(new URL(path, root)), `${fileURLToPath(new URL(path, root))} exists`);
  }
});
