import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const updaterPath = path.join(root, "extensions", "ai-addons-updater", "index.js");
const updaterUrl = new URL("file:///" + updaterPath.replace(/\\/g, "/"));

const { parseChecksum, default: updaterExtension } = await import(updaterUrl.href);

const HOME = os.homedir();
const PLUGINS_DIR = path.join(HOME, ".omp", "plugins");

const createFakePi = (execMock) => {
  let capturedHandler = null;
  return {
    registerCommand: (name, config) => {
      if (name === "ai-addons") capturedHandler = config.handler;
    },
    getHandler: () => capturedHandler,
    setLabel: () => {},
    exec: execMock,
    cwd: PLUGINS_DIR,
    env: { ...process.env, HOME },
    ui: { notify: () => {} },
  };
};

const createFakeCtx = () => ({ cwd: PLUGINS_DIR, ui: { notify: () => {} } });

test("parseChecksum returns lowercase 64-char hash for standard line with optional * and nested filename", () => {
  const checksums = `
a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  *ponytail-1.2.3.tgz
deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  some/nested/ponytail-1.2.3.tgz
`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  assert.equal(hash, "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
});

test("parseChecksum accepts a checksum line without a star", () => {
  const checksums = `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  ponytail-1.2.3.tgz\n`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  assert.equal(hash, "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
});

test("parseChecksum matches a nested filename by basename", () => {
  const checksums = `deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  some/nested/ponytail-1.2.3.tgz\n`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  assert.equal(hash, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
});

test("parseChecksum normalizes uppercase hash to lowercase", () => {
  const checksums = `DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF  ponytail-1.2.3.tgz\n`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  assert.equal(hash, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
});

test("parseChecksum returns null for malformed content and different asset", () => {
  const malformed = "not a valid checksum line\n";
  assert.equal(parseChecksum(malformed, "ponytail-1.2.3.tgz"), null);

  const mismatched = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  other-package-1.0.0.tgz\n";
  assert.equal(parseChecksum(mismatched, "ponytail-1.2.3.tgz"), null);
});

test("/ai-addons update ponytail invokes npm install @dietrichgebert/ponytail@latest with correct args and cwd", async () => {
  const execCalls = [];
  const execMock = async (cmd, args, opts) => {
    execCalls.push({ cmd, args, opts });
    return { stdout: "updated", stderr: "", code: 0 };
  };

  const fakePi = createFakePi(execMock);
  const fakeCtx = createFakeCtx();

  updaterExtension(fakePi);
  const handler = fakePi.getHandler();
  assert.ok(handler, "ai-addons command handler not registered via registerCommand");

  const result = await handler("update ponytail", fakeCtx);

  assert.equal(execCalls.length, 1, "pi.exec should be called exactly once");
  const call = execCalls[0];
  assert.equal(call.cmd, "npm");
  assert.deepEqual(call.args, [
    "install",
    "@dietrichgebert/ponytail@latest",
    "--save",
    "--no-audit",
    "--no-fund",
  ]);
  assert.equal(call.opts.cwd, PLUGINS_DIR);

  assert.match(String(result), /ponytail/i);
  assert.match(String(result), /finished|complete|done|updated/i);
});