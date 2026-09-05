import test from "node:test";
import assert from "node:assert/strict";
import { rtkPlatformSpec } from "../../extensions/lib/utils.js";

test("rtkPlatformSpec resolves known platform/arch pairs", () => {
  assert.deepEqual(rtkPlatformSpec("darwin", "arm64"), {
    triple: "aarch64-apple-darwin",
    ext: ".tar.gz",
    binary: "rtk",
  });
  assert.deepEqual(rtkPlatformSpec("win32", "x64"), {
    triple: "x86_64-pc-windows-msvc",
    ext: ".zip",
    binary: "rtk.exe",
  });
});

test("rtkPlatformSpec returns null for unknown platforms", () => {
  assert.equal(rtkPlatformSpec("plan9", "x64"), null);
});

test("rtkPlatformSpec defaults to the current runtime", () => {
  const spec = rtkPlatformSpec();
  assert.ok(spec && typeof spec.triple === "string" && typeof spec.binary === "string");
});
