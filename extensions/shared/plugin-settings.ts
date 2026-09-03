// Plugin settings reader for the Tersio extensions.
// Reads omp's persisted plugin state (~/.omp/plugins/omp-plugins.lock.json),
// written by `omp plugin config set tersio-omp <key> <value>` and by
// the installer profile step. Tolerant: any parse failure yields {} so every
// caller falls back to its own default.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
export const PLUGIN_NAME = "tersio-omp";

function lockPaths(): string[] {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return [
    path.join(os.homedir(), ".omp", "plugins", "omp-plugins.lock.json"),
    path.join(configHome, "omp", "plugins", "omp-plugins.lock.json"),
  ];
}

// `settings[PLUGIN_NAME]` in the lock file; empty object when missing.
export function readPluginSettings(): Record<string, unknown> {
  for (const p of lockPaths()) {
    if (!existsSync(p)) continue;
    try {
      const config = JSON.parse(readFileSync(p, "utf8")) as { settings?: Record<string, Record<string, unknown>> };
      const values = config.settings?.[PLUGIN_NAME];
      if (values && typeof values === "object" && !Array.isArray(values)) return values;
    } catch { /* tolerate corrupt file */ }
  }
  return {};
}

const COMBO_LEVELS = new Set(["off", "medium", "balanced", "max"]);

export function readComboDefault(): string {
  const raw = readPluginSettings().comboDefault;
  return typeof raw === "string" && COMBO_LEVELS.has(raw) ? raw : "off";
}

const CAVEMAN_MODES = new Set(["off", "lite", "full", "ultra", "wenyan"]);

export function readCavemanDefault(): string {
  const raw = readPluginSettings().cavemanDefault;
  return typeof raw === "string" && CAVEMAN_MODES.has(raw) ? raw : "off";
}

export function readRtkDefault(): boolean {
  const raw = readPluginSettings().rtkDefault;
  return typeof raw === "boolean" ? raw : false;
}
