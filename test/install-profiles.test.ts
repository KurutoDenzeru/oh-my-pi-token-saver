import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  readCavemanDefault,
  readComboDefault,
  readPluginSettings,
  readRtkDefault,
} from "../extensions/shared/plugin-settings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "install-omp-addons.js");

// Each scenario runs under its own HOME so the lock-file fixtures never
// collide with the real user state.
function withHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(path.join(os.tmpdir(), "omp-settings-test-"));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return fn(home);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function writeLock(home: string, settings: Record<string, unknown>): void {
  const dir = path.join(home, ".omp", "plugins");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "omp-plugins.lock.json"), JSON.stringify({ plugins: {}, settings }), "utf8");
}

test("readPluginSettings returns defaults when no lock file exists", () => {
  withHome(() => {
    assert.equal(readComboDefault(), "off");
    assert.equal(readCavemanDefault(), "off");
    assert.equal(readRtkDefault(), false);
    assert.deepEqual(readPluginSettings(), {});
  });
});

test("readPluginSettings picks up values from the omp lock file", () => {
  withHome((home) => {
    writeLock(home, { "oh-my-pi-token-saver": { comboDefault: "max", cavemanDefault: "wenyan", rtkDefault: true } });
    assert.equal(readComboDefault(), "max");
    assert.equal(readCavemanDefault(), "wenyan");
    assert.equal(readRtkDefault(), true);
  });
});

test("readPluginSettings ignores invalid values and other plugins", () => {
  withHome((home) => {
    writeLock(home, {
      "other-plugin": { comboDefault: "max" },
      "oh-my-pi-token-saver": { comboDefault: "yolo", cavemanDefault: 42, rtkDefault: "yes" },
    });
    assert.equal(readComboDefault(), "off");
    assert.equal(readCavemanDefault(), "off");
    assert.equal(readRtkDefault(), false);
  });
});

test("readPluginSettings tolerates a corrupt lock file", () => {
  withHome((home) => {
    const dir = path.join(home, ".omp", "plugins");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "omp-plugins.lock.json"), "{ not json", "utf8");
    assert.equal(readComboDefault(), "off");
    assert.deepEqual(readPluginSettings(), {});
  });
});

// --- Installer profile flags ---

type RunResult = { status: number | null; stdout: string; stderr: string };

function run(...args: string[]): RunResult {
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

test("installer accepts a valid profile and reports it", () => {
  const result = run("install", "--dry-run", "--scope", "project", "--yes", "--skip", "rtk", "--combo-default", "medium");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile: caveman, ponytail, updater/);
  assert.match(result.stdout, /combo default=medium/);
});

test("installer reports an --only profile", () => {
  const result = run("install", "--dry-run", "--scope", "project", "--yes", "--only", "caveman");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile: caveman\b/);
});

test("installer rejects invalid profile values", () => {
  const badCombo = run("install", "--dry-run", "--yes", "--combo-default", "ultra");
  assert.equal(badCombo.status, 1);
  assert.match(badCombo.stderr, /Invalid --combo-default/);

  const badAddon = run("install", "--dry-run", "--yes", "--only", "rtk,caveman2");
  assert.equal(badAddon.status, 1);
  assert.match(badAddon.stderr, /Invalid --only/);

  const badRtk = run("install", "--dry-run", "--yes", "--rtk-default", "maybe");
  assert.equal(badRtk.status, 1);
  assert.match(badRtk.stderr, /Invalid --rtk-default/);

  const badCaveman = run("install", "--dry-run", "--yes", "--caveman-default", "max");
  assert.equal(badCaveman.status, 1);
  assert.match(badCaveman.stderr, /Invalid --caveman-default/);

  const both = run("install", "--dry-run", "--yes", "--only", "rtk", "--skip", "rtk");
  assert.equal(both.status, 1);
  assert.match(both.stderr, /mutually exclusive/);
});

test("installer dry-run gates project-scope extensions by the profile", () => {
  const skipped = run("install", "--dry-run", "--scope", "project", "--yes", "--skip", "rtk,caveman,updater");
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.doesNotMatch(skipped.stdout, /rtk-session/);
  assert.doesNotMatch(skipped.stdout, /caveman-session\/index/);
  assert.doesNotMatch(skipped.stdout, /ai-addons-updater/);
  assert.match(skipped.stdout, /Profile: ponytail\b/);

  const full = run("install", "--dry-run", "--scope", "project", "--yes");
  assert.match(full.stdout, /rtk-session/);
  assert.match(full.stdout, /ai-addons-updater/);
});

// --- Manifest feature/setting shape ---

test("package manifest declares features and settings matching the omp schema", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    omp?: { features?: Record<string, unknown>; settings?: Record<string, unknown> };
  };
  const features = manifest.omp?.features ?? {};
  const settings = manifest.omp?.settings ?? {};

  for (const name of ["caveman", "rtk", "ponytail", "updater"]) {
    assert.ok(name in features, `feature ${name} declared`);
    const feature = features[name] as { default?: boolean; extensions?: string[] };
    assert.equal(feature.default, true, `feature ${name} defaults on`);
    for (const ext of feature.extensions ?? []) {
      const compiled = path.join(root, ext);
      assert.ok(existsSync(compiled), `feature ${name} entry exists: ${ext}`);
    }
  }

  const combo = settings.comboDefault as { type?: string; values?: string[]; default?: string };
  assert.equal(combo.type, "enum");
  assert.deepEqual(combo.values, ["off", "medium", "balanced", "max"]);
  assert.equal(combo.default, "off");

  const rtk = settings.rtkDefault as { type?: string; default?: boolean };
  assert.equal(rtk.type, "boolean");
  assert.equal(rtk.default, false);
});
