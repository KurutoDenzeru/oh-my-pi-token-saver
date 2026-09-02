import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "install-omp-addons.js");
const MARKER = "# managed by `headroom wrap omp`";

type RunResult = { status: number | null; stdout: string; stderr: string };

interface EnvOverrides {
  HOME: string;
  USERPROFILE: string;
  PATH: string;
  OMP_PROFILE?: string;
  PI_PROFILE?: string;
}

function run(args: string[], env: EnvOverrides): RunResult {
  const result = spawnSync(process.execPath, [installer, ...args], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function fakeHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "omp-hr-test-"));
}

function writeManagedModels(home: string, port = 8787): string {
  const agentDir = path.join(home, ".omp", "agent");
  mkdirSync(agentDir, { recursive: true });
  const models = path.join(agentDir, "models.yml");
  writeFileSync(
    models,
    `${MARKER} — do not hand-edit while wrapped.\nproviders:\n  anthropic:\n    baseUrl: http://127.0.0.1:${port}\n`,
    "utf8",
  );
  return models;
}

function writeUnmanagedModels(home: string): string {
  const agentDir = path.join(home, ".omp", "agent");
  mkdirSync(agentDir, { recursive: true });
  const models = path.join(agentDir, "models.yml");
  writeFileSync(models, "providers:\n  anthropic:\n    apiKey: sk-test\n", "utf8");
  return models;
}

// Fake `headroom` CLI on PATH: logs argv to stdout, exits 0. Lets tests assert
// unwrap was actually invoked without installing the real Python package.
function withFakeHeadroom(binDir: string): string {
  mkdirSync(binDir, { recursive: true });
  const headroom = path.join(binDir, "headroom");
  writeFileSync(headroom, "#!/bin/sh\necho \"fake-headroom argv: $*\"\n", "utf8");
  chmodSync(headroom, 0o755);
  return binDir;
}

function envFor(home: string, extra?: { headroom?: boolean }): EnvOverrides {
  const pathValue = extra?.headroom
    ? withFakeHeadroom(path.join(home, "bin")) + path.delimiter + process.env.PATH
    : process.env.PATH || "";
  return { HOME: home, USERPROFILE: home, PATH: pathValue };
}

test("doctor reports not wrapped when models.yml is absent or unmanaged", () => {
  const home = fakeHome();
  try {
    const missing = run(["doctor"], envFor(home));
    assert.match(missing.stdout, /Headroom: not wrapped/);

    writeUnmanagedModels(home);
    const unmanaged = run(["doctor"], envFor(home));
    assert.match(unmanaged.stdout, /Headroom: not wrapped/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports wrapped with the proxy port from managed models.yml", () => {
  const home = fakeHome();
  try {
    writeManagedModels(home, 8123);
    const result = run(["doctor"], envFor(home));
    assert.match(result.stdout, /Headroom: wrapped \(proxy http:\/\/127\.0\.0\.1:8123/);
    // 8123 has no listener; doctor must still exit 0 and report NOT running.
    assert.match(result.stdout, /NOT running/);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --with-headroom prints wrap instructions when the CLI exists", () => {
  const home = fakeHome();
  try {
    const result = run(["install", "--dry-run", "--scope", "user", "--yes", "--with-headroom"], envFor(home, { headroom: true }));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /headroom CLI found/);
    assert.match(result.stdout, /headroom wrap omp/);
    assert.match(result.stdout, /headroom unwrap omp/);
    // Dry-run must not create the models file.
    assert.equal(run(["install", "--dry-run", "--scope", "user", "--yes", "--with-headroom"], envFor(home)).status, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --with-headroom without the CLI prints install hints and exits 0", () => {
  const home = fakeHome();
  try {
    const result = run(["install", "--dry-run", "--scope", "user", "--yes", "--with-headroom"], envFor(home));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /headroom CLI not found/);
    assert.match(result.stdout, /headroom-ai\[all\]/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --with-headroom is opt-in: default install never mentions headroom", () => {
  const home = fakeHome();
  try {
    const result = run(["install", "--dry-run", "--scope", "project", "--yes"], envFor(home));
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /[Hh]eadroom/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --remove-headroom dry-run only previews the unwrap", () => {
  const home = fakeHome();
  try {
    writeManagedModels(home);
    const result = run(["uninstall", "--dry-run", "--yes", "--remove-headroom"], envFor(home, { headroom: true }));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would run: headroom unwrap omp/);
    // File untouched by dry-run.
    const modelsAfter = readFileSync(path.join(home, ".omp", "agent", "models.yml"), "utf8");
    assert.match(modelsAfter, /managed by/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --remove-headroom invokes headroom unwrap omp on a managed file", () => {
  const home = fakeHome();
  try {
    writeManagedModels(home);
    const result = run(["uninstall", "--yes", "--remove-headroom"], envFor(home, { headroom: true }));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fake-headroom argv: unwrap omp/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --remove-headroom leaves an unmanaged models.yml untouched", () => {
  const home = fakeHome();
  try {
    writeUnmanagedModels(home);
    const result = run(["uninstall", "--yes", "--remove-headroom"], envFor(home, { headroom: true }));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /not wrap-managed/);
    assert.doesNotMatch(result.stdout, /fake-headroom argv: unwrap/);
    assert.doesNotMatch(result.stdout, /fake-headroom argv: unwrap/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall without --remove-headroom never runs headroom unwrap", () => {
  const home = fakeHome();
  try {
    writeManagedModels(home);
    const result = run(["uninstall", "--dry-run", "--yes"], envFor(home, { headroom: true }));
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /headroom unwrap omp/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
