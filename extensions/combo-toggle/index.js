// /combo session toggle — set all three (caveman, rtk, ponytail) at once.
// Modes: off | medium | max

const LEVELS = {
  off: {
    caveman: "off",
    rtk: "off",
    ponytail: "off",
  },
  medium: {
    caveman: "lite",
    rtk: "on",
    ponytail: "lite",
  },
  max: {
    caveman: "ultra",
    rtk: "on",
    ponytail: "ultra",
  },
};

const DEFAULT_LEVEL = "off";

function normalizeLevel(value) {
  const v = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, v) ? v : null;
}

function statusMessage(currentLevels) {
  const c = currentLevels.caveman === "off" ? "off" : currentLevels.caveman;
  const r = currentLevels.rtk === "off" ? "off" : currentLevels.rtk;
  const p = currentLevels.ponytail === "off" ? "off" : currentLevels.ponytail;
  return `Combo: caveman=${c} rtk=${r} ponytail=${p}`;
}

function levelSummary(level) {
  const v = LEVELS[level];
  return `caveman=${v.caveman} rtk=${v.rtk} ponytail=${v.ponytail}`;
}

export default function comboToggleExtension(pi) {
  pi.setLabel?.("Combo session toggle (all 3 add-ons)");

  pi.registerCommand("combo", {
    description: "Toggle all 3 OMP add-ons at once. Usage: /combo <off|medium|max|status>",
    handler: async (args, ctx) => {
      const arg = String(args || "").trim().toLowerCase();

      if (!arg || arg === "status") {
        ctx?.ui?.notify?.("Combo levels: off | medium | max. Run `/combo <level>` to apply.", "info");
        return;
      }

      if (arg === "help") {
        ctx?.ui?.notify?.(
          "/combo off    — disables all 3 (caveman, rtk, ponytail)\n" +
          "/combo medium — light: caveman=lite, rtk=on, ponytail=lite\n" +
          "/combo max    — aggressive: caveman=ultra, rtk=on, ponytail=ultra",
          "info"
        );
        return;
      }

      const level = normalizeLevel(arg);
      if (!level) {
        ctx?.ui?.notify?.(
          `Unknown combo level: ${arg}. Use: off | medium | max`,
          "warning"
        );
        return;
      }

      const levels = LEVELS[level];

      // Persist per-extension state so they restore on session_start
      pi.appendEntry("caveman-mode", { mode: levels.caveman });
      pi.appendEntry("rtk-mode", { enabled: levels.rtk === "on" });
      pi.appendEntry("ponytail-mode", { mode: levels.ponytail });

      // Also persist which /combo level was last picked (for /combo status)
      pi.appendEntry("combo-level", { level });

      // Trigger per-add-on slash commands so they take effect immediately
      // (the next prompt will pick up the new mode via session_start).
      const trigger = `/caveman ${levels.caveman} • /rtk ${levels.rtk === "on" ? "on" : "off"} • /ponytail ${levels.ponytail}`;
      ctx?.ui?.notify?.(
        `Combo ${level}: ${levelSummary(level)}. Run: ${trigger}`,
        "info"
      );
    },
  });

  pi.on("input", async (event) => {
    if (event?.source === "extension") return;
    const t = String(event?.text || "").trim().toLowerCase().replace(/[.!?\s]+$/, "");
    const level = normalizeLevel(t.replace(/^combo\s+/, ""));
    if (level) {
      const levels = LEVELS[level];
      pi.appendEntry("caveman-mode", { mode: levels.caveman });
      pi.appendEntry("rtk-mode", { enabled: levels.rtk === "on" });
      pi.appendEntry("ponytail-mode", { mode: levels.ponytail });
      pi.appendEntry("combo-level", { level });
    }
  });
}
