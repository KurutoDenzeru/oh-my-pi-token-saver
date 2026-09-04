import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveLevel,
  isComboPresetActive,
  resetSharedComboState,
  setSharedComboLevel,
} from "../../extensions/shared/session-state.js";

test("deriveLevel maps every preset back to its level, including balanced", () => {
  assert.equal(deriveLevel({ caveman: "off", rtk: "off", ponytail: "off" }), "off");
  assert.equal(deriveLevel({ caveman: "lite", rtk: "on", ponytail: "lite" }), "medium");
  assert.equal(deriveLevel({ caveman: "full", rtk: "on", ponytail: "full" }), "balanced");
  assert.equal(deriveLevel({ caveman: "ultra", rtk: "on", ponytail: "ultra" }), "max");
});

test("deriveLevel returns custom for mixed modes", () => {
  assert.equal(deriveLevel({ caveman: "full", rtk: "off", ponytail: "full" }), "custom");
});

test("isComboPresetActive is true for presets, false for off", () => {
  try {
    for (const level of ["medium", "balanced", "max"]) {
      setSharedComboLevel(level);
      assert.equal(isComboPresetActive(), true);
    }
    setSharedComboLevel("off");
    assert.equal(isComboPresetActive(), false);
  } finally {
    resetSharedComboState();
  }
});
