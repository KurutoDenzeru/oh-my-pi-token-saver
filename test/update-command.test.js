import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "install-omp-addons.js");

test("update delegates to the latest package non-interactively", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-test-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, "@echo off\r\necho fake-npm %*\r\n", "utf8");
    } else {
      writeFileSync(npm, "#!/bin/sh\nprintf 'fake-npm %s\\n' \"$*\"\n", "utf8");
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update", "--dry-run", "--scope", "project"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        },
        timeout: 10000,
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /fake-npm exec --yes --prefer-online --package=@fernado03\/oh-my-pi-supreme-token-saver@latest -- oh-my-pi-supreme-token-saver --apply-update --yes --scope project --dry-run/
    );
    assert.match(result.stdout, /=== Update complete ===/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});
