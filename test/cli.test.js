import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "install-omp-addons.js");
const { version } = createRequire(import.meta.url)("../package.json");

function run(...args) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
  });
}

for (const alias of [["version"], ["--version"], ["-v"]]) {
  test(`${alias[0]} prints only the package version`, () => {
    const result = run(...alias);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${version}\n`);
    assert.equal(result.stderr, "");
  });
}

for (const alias of [["help"], ["--help"], ["-h"]]) {
  test(`${alias[0]} prints help`, () => {
    const result = run(...alias);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage:/);
    for (const command of ["install", "update", "reinstall", "doctor", "uninstall", "version", "help"]) {
      assert.match(result.stdout, new RegExp(`^  ${command}\\s`, "m"));
    }
    assert.equal(result.stderr, "");
  });
}

test("an unknown command fails with usage and no installer output", () => {
  const result = run("definitely-not-a-command");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: definitely-not-a-command/);
  assert.match(result.stdout, /^Usage:/);
  assert.doesNotMatch(result.stdout, /Prerequisites:|Installing|Will remove:/);
});

test("project dry-run previews shared bridge before dependent extensions without writing", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run", "--scope", "project"],
    {
      encoding: "utf8",
      cwd: path.join(root, "test"),
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const shared = result.stdout.indexOf(path.join("shared", "session-state.js"));
  const rtk = result.stdout.indexOf("rtk-session");
  const caveman = result.stdout.indexOf("caveman-session");
  assert.ok(shared >= 0, result.stdout);
  assert.ok(rtk > shared, result.stdout);
  assert.ok(caveman > shared, result.stdout);
  assert.match(result.stdout, /\[dry-run\] would write .*shared[\\/]session-state\.js/);
  assert.equal(existsSync(path.join(root, "extensions", "shared-session-state.js")), false);
});

test("uninstall dry-run previews shared bridge removal", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "uninstall", "--dry-run", "--yes"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[dry-run\] would remove .*extensions[\\/]shared(?:\r?\n|$)/);
});
