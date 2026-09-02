const BRIDGE_KEY = Symbol.for("oh-my-pi-token-saver/combo-session-state");

export const OMP_SUBAGENT_MARKER = "You are operating on a piece of work assigned to you by the main agent.";

export const COMBO_LEVELS = Object.freeze({
  off: Object.freeze({ level: "off", caveman: "off", rtk: "off", ponytail: "off" }),
  medium: Object.freeze({ level: "medium", caveman: "lite", rtk: "on", ponytail: "lite" }),
  balanced: Object.freeze({ level: "balanced", caveman: "full", rtk: "on", ponytail: "full" }),
  max: Object.freeze({ level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra" }),
});

const MODE_VALUES = {
  caveman: new Set(["off", "lite", "full", "ultra", "wenyan"]),
  rtk: new Set(["off", "on"]),
  ponytail: new Set(["off", "lite", "full", "ultra", "review"]),
};

function normalizeMode(name, value) {
  if (name === "rtk" && typeof value === "boolean") return value ? "on" : "off";
  const mode = String(value ?? "").trim().toLowerCase();
  return MODE_VALUES[name]?.has(mode) ? mode : null;
}

function deriveLevel(modes) {
  for (const level of ["off", "medium", "max"]) {
    const preset = COMBO_LEVELS[level];
    if (preset.caveman === modes.caveman && preset.rtk === modes.rtk && preset.ponytail === modes.ponytail) return level;
  }
  return "custom";
}

function isKnownLevel(value) {
  return value === "custom" || Object.prototype.hasOwnProperty.call(COMBO_LEVELS, value);
}

function levelForIndividualModes(modes) {
  return modes.caveman === "off" && modes.rtk === "off" && modes.ponytail === "off" ? "off" : "custom";
}

function normalizedState(modes, level = deriveLevel(modes)) {
  const state = {
    caveman: normalizeMode("caveman", modes?.caveman) || "off",
    rtk: normalizeMode("rtk", modes?.rtk) || "off",
    ponytail: normalizeMode("ponytail", modes?.ponytail) || "off",
  };
  return Object.freeze({ level: isKnownLevel(level) ? level : deriveLevel(state), ...state });
}

function bridge() {
  const existing = globalThis[BRIDGE_KEY];
  if (existing?.state) return existing;
  const initial = normalizedState(existing || COMBO_LEVELS.off);
  return (globalThis[BRIDGE_KEY] = { state: initial, listener: null });
}

function publish(state) {
  const shared = bridge();
  shared.state = state;
  shared.listener?.(state);
  return state;
}

export function isOmpSubagentPrompt(systemPrompt) {
  const prompts = Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt];
  return prompts.some((prompt) => typeof prompt === "string" && prompt.includes(OMP_SUBAGENT_MARKER));
}

export function normalizeComboLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COMBO_LEVELS, level) ? level : null;
}

export function getSharedComboState() {
  return bridge().state;
}

export function setSharedComboLevel(value) {
  const level = normalizeComboLevel(value) || "off";
  return publish(normalizedState(COMBO_LEVELS[level], level));
}

export function setSharedComboMode(name, value) {
  const mode = normalizeMode(name, value);
  if (!mode) return getSharedComboState();
  const modes = { ...getSharedComboState(), [name]: mode };
  return publish(normalizedState(modes, levelForIndividualModes(modes)));
}

export function reconcileSharedComboEntries(entries) {
  let modes = { ...COMBO_LEVELS.off };
  let level = "off";
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (entry?.type !== "custom") continue;
      if (entry.customType === "combo-level") {
        const preset = normalizeComboLevel(entry?.data?.level);
        if (preset) {
          modes = { ...COMBO_LEVELS[preset] };
          level = preset;
        }
        continue;
      }
      const name = entry.customType === "caveman-mode"
        ? "caveman"
        : entry.customType === "rtk-mode"
          ? "rtk"
          : entry.customType === "ponytail-mode"
            ? "ponytail"
            : null;
      if (!name) continue;
      const value = name === "rtk" ? entry?.data?.enabled : entry?.data?.mode;
      const mode = normalizeMode(name, value);
      if (mode) {
        modes[name] = mode;
        level = levelForIndividualModes(modes);
      }
    }
  }
  return publish(normalizedState(modes, level));
}

export function setSharedComboListener(listener) {
  const shared = bridge();
  shared.listener = typeof listener === "function" ? listener : null;
  return () => {
    if (shared.listener === listener) shared.listener = null;
  };
}

export function resetSharedComboState() {
  return setSharedComboLevel("off");
}
