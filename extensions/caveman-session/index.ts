import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getSharedComboState, isComboPresetActive, isOmpSubagentPrompt, sessionEntries, setSharedComboMode } from '../shared/session-state.ts';
import { readCavemanDefault } from '../shared/plugin-settings.ts';
import type { ExtensionApi, ExtensionCtx, InputEvent, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

const CAVERN_DIR = dirname(fileURLToPath(import.meta.url));
const RULE_PATH = join(CAVERN_DIR, 'rule.md');

const FALLBACK_FULL_RULE = `Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop articles (a/an/the), filler (just/really/basically), pleasantries, hedging.
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: 'Sure! I'd be happy to help you with that.'
- Yes: 'Bug in auth middleware. Fix:'

Auto-clarity: drop caveman for security warnings, irreversible actions, or when user seems confused. Resume after.`;

// ponytail: synchronous read each full-mode injection; ceiling = small file, cold session start. Upgrade path: cache file contents + mtime, invalidate on change.
function readFullRule(): string {
  try { return readFileSync(RULE_PATH, 'utf8'); } catch { return FALLBACK_FULL_RULE; }
}

const DEFAULT_MODE = 'off';
const MODES = new Set(['off', 'lite', 'full', 'ultra', 'wenyan']);

const INSTRUCTIONS: Record<string, string | (() => string)> = {
  lite: `Caveman lite active for this session.
Respond concise. Drop pleasantries, filler, and hedging. Keep complete technical substance. Code, commands, paths, errors, commits, and PR text stay normal/exact.`,
  full: () => `Caveman full active for this session.\n${readFullRule()}`,
  ultra: `Caveman ultra active for this session.
Maximum terse prose. Fragments preferred. No pleasantries, no tour, no recap unless needed. Keep all technical substance exact. Code, commands, commits, PR text, paths, and errors stay normal/exact. Drop caveman for security warnings, irreversible actions, or user confusion.`,
  wenyan: `Caveman wenyan active for this session.
Use ultra-terse classical-Chinese-style prose only where it preserves clarity for the user. Keep technical terms, code, commands, commits, PR text, paths, and errors exact. If clarity would suffer, use caveman full instead.`,
};

function normalizeMode(value: unknown): string | null {
  const mode = String(value || '').trim().toLowerCase();
  return MODES.has(mode) ? mode : null;
}

function resolveMode(entries: SessionEntry[] | null | undefined, fallback: string = DEFAULT_MODE): string {
  if (!Array.isArray(entries)) return fallback;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== 'custom' || entry?.customType !== 'caveman-mode') continue;
    const mode = normalizeMode(entry?.data?.mode);
    if (mode) return mode;
  }
  return fallback;
}

function isOffCommand(text: unknown): boolean {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return t === 'stop caveman' || t === 'normal mode' || t === 'caveman off';
}

export default function cavemanSessionExtension(pi: ExtensionApi): void {
  let currentMode = DEFAULT_MODE;
  let isActive = false;
  let lastCtx: ExtensionCtx | undefined = undefined;

  function syncStatus(ctx?: ExtensionCtx): void {
    if (ctx) lastCtx = ctx;
    const c = ctx || lastCtx;
    if (!c?.ui?.setStatus) return;
    // Combo owns the bar when any preset is active; keep ours empty to avoid duplication.
    if (isComboPresetActive()) {
      c.ui.setStatus('caveman', undefined);
      return;
    }
    if (currentMode === 'off') {
      c.ui.setStatus('caveman', undefined);
      return;
    }
    const theme = c.ui.theme;
    const indicator = isActive && theme?.fg ? theme.fg('accent', '🪨') : '🪨';
    const label = `caveman: ${currentMode.toUpperCase()}`;
    c.ui.setStatus('caveman', theme?.fg ? `${indicator} ${theme.fg('muted', label)}` : `${indicator} ${label}`);
  }

  function setMode(mode: string, ctx?: ExtensionCtx): boolean {
    const normalized = normalizeMode(mode);
    if (!normalized) return false;
    currentMode = normalized;
    pi.appendEntry?.('caveman-mode', { mode: normalized });
    setSharedComboMode('caveman', normalized);
    syncStatus(ctx);
    ctx?.ui?.notify?.(`Caveman mode ${normalized === 'off' ? 'off' : `set to ${normalized}`}.`, 'info');
    return true;
  }

  pi.setLabel?.('Caveman session toggle');

  pi.registerCommand?.('caveman', {
    description: 'Toggle terse caveman replies for this session',
    handler: async (args, ctx) => {
      const arg = String(args || '').trim().toLowerCase();
      if (!arg || arg === 'on') {
        setMode('full', ctx);
        return;
      }
      if (arg === 'status') {
        ctx?.ui?.notify?.(`Caveman: ${currentMode}`, 'info');
        return;
      }
      if (!setMode(arg, ctx)) {
        ctx?.ui?.notify?.('Usage: /caveman [lite|full|ultra|wenyan|off|status]', 'warning');
      }
    },
  });

  pi.on<InputEvent>('input', async (event) => {
    if (event?.source === 'extension') return;
    if (currentMode !== 'off' && isOffCommand(event?.text)) setMode('off');
  });

  function restoreMode(ctx?: ExtensionCtx): void {
    const entries = sessionEntries(ctx);
    // Persisted session state wins; a fresh session falls back to the
    // installer/user-configured default (off unless configured).
    const persisted = resolveMode(entries, '');
    currentMode = persisted || readCavemanDefault();
    syncStatus(ctx);
  }

  pi.on('session_start', async (_event, ctx) => {
    restoreMode(ctx);
    ctx?.ui?.notify?.(`Caveman loaded: ${currentMode}`, 'info');
  });

  pi.on('session_branch', async (_event, ctx) => {
    restoreMode(ctx);
  });

  pi.on('session_tree', async (_event, ctx) => {
    restoreMode(ctx);
  });

  pi.on('agent_start', async (_event, ctx) => {
    isActive = true;
    syncStatus(ctx);
  });

  pi.on('agent_end', async (_event, ctx) => {
    isActive = false;
    syncStatus(ctx);
  });

  pi.on('before_agent_start', async (event: SystemPromptEvent) => {
    const mode = isOmpSubagentPrompt(event.systemPrompt) ? getSharedComboState().caveman : currentMode;
    if (!mode || mode === 'off') return;
    const def = INSTRUCTIONS[mode];
    if (!def) return;
    const instruction = typeof def === 'function' ? def() : def;
    const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [event.systemPrompt];
    return { systemPrompt: [...base, instruction] };
  });
}
