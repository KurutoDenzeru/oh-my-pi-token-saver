// /combo session toggle — set all three (caveman, rtk, ponytail) at once.
// Modes: off | medium | balanced | max

import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  COMBO_LEVELS,
  getSharedComboState,
  isComboPresetActive,
  isOmpSubagentPrompt,
  normalizeComboLevel,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  setSharedComboListener,
  systemPromptIncludes,
} from '../shared/session-state.ts';
import { readComboDefault } from '../shared/plugin-settings.ts';
import type { ComboState, ExtensionApi, ExtensionCtx, SystemPromptEvent } from '../shared/types.ts';

const require = createRequire(import.meta.url);

function ponytailFallback(mode: string): string {
  const intensity = mode === 'lite'
    ? 'Prefer the simplest correct solution.'
    : mode === 'review'
      ? 'Review only for avoidable complexity; recommend the smallest correct replacement.'
      : 'Use the minimum correct solution. Delete or reuse before adding.';
  return `🦥 PONYTAIL MODE ACTIVE — level: ${mode}\n${intensity} Understand the path first and fix root causes, not symptoms. Prefer the standard library and YAGNI. Avoid speculative abstractions and dependencies. Preserve correctness. Verify changed behavior.`;
}

function levelSummary(state: ComboState): string {
  return `caveman=${state.caveman} rtk=${state.rtk} ponytail=${state.ponytail}`;
}

function hasPonytailInstructions(systemPrompt: string | string[]): boolean {
  return systemPromptIncludes(systemPrompt, 'PONYTAIL MODE ACTIVE');
}

function loadPonytailInstructions(mode: string): string {
  try {
    const installed = path.join(
      os.homedir(),
      '.omp',
      'plugins',
      'node_modules',
      '@dietrichgebert',
      'ponytail',
      'hooks',
      'ponytail-instructions.js'
    );
    const { getPonytailInstructions } = require(installed) as { getPonytailInstructions?: (mode: string) => string };
    if (typeof getPonytailInstructions === 'function') return getPonytailInstructions(mode);
  } catch {}
  return ponytailFallback(mode);
}

export default function comboToggleExtension(pi: ExtensionApi): void {
  pi.setLabel?.('Combo session toggle (all 3 add-ons)');

  let currentState: Readonly<ComboState> = getSharedComboState();
  let lastCtx: ExtensionCtx | undefined = undefined;

  function syncStatus(ctx?: ExtensionCtx): void {
    if (ctx) lastCtx = ctx;
    const c = ctx || lastCtx;
    if (!c?.ui?.setStatus) return;
    // Single unified bar replaces the three per-extension bars while a preset is
    // active. In custom/off, the individual bars come back and combo stays clear.
    if (!isComboPresetActive()) {
      c.ui.setStatus('combo', undefined);
      return;
    }
    const theme = c.ui.theme;
    const c0 = currentState.caveman.toUpperCase();
    const r = currentState.rtk.toUpperCase();
    const p = currentState.ponytail.toUpperCase();
    const lvl = currentState.level.toUpperCase();
    const label = `combo ${lvl}: 🪨caveman=${c0} ⚡rtk=${r} 🦥ponytail=${p}`;
    c.ui.setStatus('combo', theme?.fg ? `${theme.fg('accent', '🧩')} ${theme.fg('muted', label)}` : `🧩 ${label}`);
    // Clobber any sibling bars another extension may have painted in a race
    // during session_start — our bar is canonical for the duration of the preset.
    c.ui.setStatus('caveman', undefined);
    c.ui.setStatus('rtk', undefined);
    c.ui.setStatus('ponytail', undefined);
  }

  // ponytail: same persistence as /combo — siblings (incl. upstream ponytail)
  // restore from these entries, so the fallback must write them too or the
  // preset evaporates on resume and ponytail never activates.
  function persistPreset(level: string): void {
    const modes = COMBO_LEVELS[level];
    pi.appendEntry?.('caveman-mode', { mode: modes.caveman });
    pi.appendEntry?.('rtk-mode', { enabled: modes.rtk === 'on' });
    pi.appendEntry?.('ponytail-mode', { mode: modes.ponytail });
    pi.appendEntry?.('combo-level', { level });
  }

  function useState(state: Readonly<ComboState>, ctx?: ExtensionCtx): Readonly<ComboState> {
    currentState = state;
    syncStatus(ctx);
    return state;
  }

  function reconcile(ctx?: ExtensionCtx): Readonly<ComboState> {
    if (!ctx?.hasUI) return currentState;
    return useState(reconcileSharedComboEntries(sessionEntries(ctx)), ctx);
  }
  function listen(ctx?: ExtensionCtx): void {
    if (ctx?.hasUI) setSharedComboListener((state) => useState(state));
  }

  pi.registerCommand?.('combo', {
    description: 'Toggle all 3 OMP add-ons at once. Usage: /combo <off|medium|balanced|max|status>',
    handler: async (args, ctx) => {
      listen(ctx);
      const arg = String(args || '').trim().toLowerCase();

      if (!arg || arg === 'status') {
        const state = reconcile(ctx);
        ctx?.ui?.notify?.(
          `Combo: ${state.level === 'custom' ? 'INACTIVE' : state.level.toUpperCase()} (${levelSummary(state)})`,
          'info'
        );
        return;
      }

      if (arg === 'help') {
        ctx?.ui?.notify?.(
          '/combo off      — disables all 3 (caveman, rtk, ponytail)\n' +
          '/combo medium   — light: caveman=lite, rtk=on, ponytail=lite\n' +
          '/combo balanced — middle: caveman=full, rtk=on, ponytail=full\n' +
          '/combo max      — aggressive: caveman=ultra, rtk=on, ponytail=ultra',
          'info'
        );
        return;
      }

      const level = normalizeComboLevel(arg);
      if (!level) {
        ctx?.ui?.notify?.(
          `Unknown combo level: ${arg}. Use: off | medium | balanced | max`,
          'warning'
        );
        return;
      }

      persistPreset(level);
      useState(setSharedComboLevel(level), ctx);

      ctx?.ui?.notify?.(
        `Combo ${level} applied: ${levelSummary(currentState)}`,
        'info'
      );

      if (ctx?.reload) await ctx.reload();
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    listen(ctx);
    if (ctx?.hasUI) reconcile(ctx);
    else syncStatus(ctx);
    // Installer/user-configured default applies only to a fresh session with
    // no persisted state — real session state always wins.
    if (getSharedComboState().level === 'off' && !sessionEntries(ctx).length) {
      const fallback = readComboDefault();
      if (fallback !== 'off') {
        persistPreset(fallback);
        useState(setSharedComboLevel(fallback), ctx);
        ctx?.ui?.notify?.(`Combo default applied: ${fallback}`, 'info');
      }
    }
  });

  for (const event of ['session_branch', 'session_tree', 'agent_start']) {
    pi.on(event, async (_event, ctx) => {
      listen(ctx);
      if (ctx?.hasUI) reconcile(ctx);
    });
  }

  pi.on<SystemPromptEvent>('before_agent_start', async (event, ctx) => {
    if (ctx?.hasUI) reconcile(ctx);
    if (!isOmpSubagentPrompt(event.systemPrompt)) return;

    const mode = getSharedComboState().ponytail;
    if (mode === 'off' || hasPonytailInstructions(event.systemPrompt)) return;
    const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [event.systemPrompt];
    return { systemPrompt: [...base, loadPonytailInstructions(mode)] };
  });

  // Slash commands only; natural-language input caused accidental toggles and has no reload context.
}
