// /combo session toggle — set all three (caveman, rtk, ponytail) at once.
// Modes: off | medium | max

import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  COMBO_LEVELS,
  getSharedComboState,
  isOmpSubagentPrompt,
  normalizeComboLevel,
  reconcileSharedComboEntries,
  setSharedComboLevel,
  setSharedComboListener,
} from "../shared/session-state.js";

const require = createRequire(import.meta.url);

function ponytailFallback(mode) {
  const intensity = mode === "lite"
    ? "Prefer the simplest correct solution."
    : mode === "review"
      ? "Review only for avoidable complexity; recommend the smallest correct replacement."
      : "Use the minimum correct solution. Delete or reuse before adding.";
  return `PONYTAIL MODE ACTIVE — level: ${mode}\n${intensity} Understand the path first and fix root causes, not symptoms. Prefer the standard library and YAGNI. Avoid speculative abstractions and dependencies. Preserve correctness. Verify changed behavior.`;
}

function entriesFrom(ctx) {
  return ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
}

function levelSummary(state) {
  return `caveman=${state.caveman} rtk=${state.rtk} ponytail=${state.ponytail}`;
}

function hasPonytailInstructions(systemPrompt) {
  const prompts = Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt];
  return prompts.some((prompt) => typeof prompt === "string" && prompt.includes("PONYTAIL MODE ACTIVE"));
}

function loadPonytailInstructions(mode) {
  try {
    const installed = path.join(
      os.homedir(),
      ".omp",
      "plugins",
      "node_modules",
      "@dietrichgebert",
      "ponytail",
      "hooks",
      "ponytail-instructions.js"
    );
    const { getPonytailInstructions } = require(installed);
    if (typeof getPonytailInstructions === "function") return getPonytailInstructions(mode);
  } catch {}
  return ponytailFallback(mode);
}

export default function comboToggleExtension(pi) {
  pi.setLabel?.("Combo session toggle (all 3 add-ons)");

  let currentState = getSharedComboState();
  let lastCtx = null;

  function syncStatus(ctx) {
    if (ctx) lastCtx = ctx;
    const c = ctx || lastCtx;
    if (!c?.ui?.setStatus) return;

    if (currentState.level === "off") {
      c.ui.setStatus("combo", "");
      return;
    }

    const theme = c.ui.theme;
    const indicator = theme?.fg ? theme.fg("accent", "🧩") : "🧩";
    const label = `combo: ${currentState.level.toUpperCase()} · caveman=${currentState.caveman.toUpperCase()} · rtk=${currentState.rtk.toUpperCase()} · ponytail=${currentState.ponytail.toUpperCase()}`;
    c.ui.setStatus("combo", theme?.fg ? `${indicator} ${theme.fg("muted", label)}` : `${indicator} ${label}`);
  }

  function useState(state, ctx) {
    currentState = state;
    syncStatus(ctx);
    return state;
  }

  function reconcile(ctx) {
    if (!ctx?.hasUI) return currentState;
    return useState(reconcileSharedComboEntries(entriesFrom(ctx)), ctx);
  }
  function listen(ctx) {
    if (ctx?.hasUI) setSharedComboListener((state) => useState(state));
  }


  pi.registerCommand("combo", {
    description: "Toggle all 3 OMP add-ons at once. Usage: /combo <off|medium|max|status>",
    handler: async (args, ctx) => {
      listen(ctx);
      const arg = String(args || "").trim().toLowerCase();

      if (!arg || arg === "status") {
        const state = reconcile(ctx);
        ctx?.ui?.notify?.(
          `Combo: ${state.level.toUpperCase()} (${levelSummary(state)})`,
          "info"
        );
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

      const level = normalizeComboLevel(arg);
      if (!level) {
        ctx?.ui?.notify?.(
          `Unknown combo level: ${arg}. Use: off | medium | max`,
          "warning"
        );
        return;
      }

      const modes = COMBO_LEVELS[level];

      // Persist per-extension state so they restore on session_start
      pi.appendEntry("caveman-mode", { mode: modes.caveman });
      pi.appendEntry("rtk-mode", { enabled: modes.rtk === "on" });
      pi.appendEntry("ponytail-mode", { mode: modes.ponytail });
      pi.appendEntry("combo-level", { level });

      useState(setSharedComboLevel(level), ctx);

      ctx?.ui?.notify?.(
        `Combo ${level} applied: ${levelSummary(currentState)}`,
        "info"
      );

      if (ctx?.reload) await ctx.reload();
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    listen(ctx);
    if (ctx?.hasUI) reconcile(ctx);
    else syncStatus(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    listen(ctx);
    if (ctx?.hasUI) reconcile(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (ctx?.hasUI) reconcile(ctx);
    if (!isOmpSubagentPrompt(event.systemPrompt)) return;

    const mode = getSharedComboState().ponytail;
    if (mode === "off" || hasPonytailInstructions(event.systemPrompt)) return;
    const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [event.systemPrompt];
    return { systemPrompt: [...base, loadPonytailInstructions(mode)] };
  });

  // Slash commands only; natural-language input caused accidental toggles and has no reload context.
}