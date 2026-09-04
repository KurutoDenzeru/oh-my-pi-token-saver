import type { ComboLevel, ComboState, ExtensionCtx, SessionEntry } from './types.ts';

const BRIDGE_KEY = Symbol.for('tersio/combo-session-state');

export const OMP_SUBAGENT_MARKER = 'You are operating on a piece of work assigned to you by the main agent.';

export const COMBO_LEVELS: Record<string, Readonly<ComboState>> = Object.freeze({
  off: Object.freeze({ level: 'off', caveman: 'off', rtk: 'off', ponytail: 'off' }),
  medium: Object.freeze({ level: 'medium', caveman: 'lite', rtk: 'on', ponytail: 'lite' }),
  balanced: Object.freeze({ level: 'balanced', caveman: 'full', rtk: 'on', ponytail: 'full' }),
  max: Object.freeze({ level: 'max', caveman: 'ultra', rtk: 'on', ponytail: 'ultra' }),
});

const MODE_VALUES: Record<string, Set<string>> = {
  caveman: new Set(['off', 'lite', 'full', 'ultra', 'wenyan']),
  rtk: new Set(['off', 'on']),
  ponytail: new Set(['off', 'lite', 'full', 'ultra', 'review']),
};

type ModeName = 'caveman' | 'rtk' | 'ponytail';
type Modes = Record<ModeName, string>;

interface Bridge {
  state: Readonly<ComboState>;
  listener: ((state: Readonly<ComboState>) => void) | null;
}

function normalizeMode(name: ModeName, value: unknown): string | null {
  if (name === 'rtk' && typeof value === 'boolean') return value ? 'on' : 'off';
  const mode = String(value ?? '').trim().toLowerCase();
  return MODE_VALUES[name]?.has(mode) ? mode : null;
}

export function deriveLevel(modes: Modes | null | undefined): ComboLevel {
  for (const level of Object.keys(COMBO_LEVELS) as ComboLevel[]) {
    const preset = COMBO_LEVELS[level];
    if (preset.caveman === modes?.caveman && preset.rtk === modes?.rtk && preset.ponytail === modes?.ponytail) return level;
  }
  return 'custom';
}

function isPresetLevel(value: string): value is ComboLevel {
  return Object.prototype.hasOwnProperty.call(COMBO_LEVELS, value);
}

function isKnownLevel(value: string): boolean {
  return value === 'custom' || isPresetLevel(value);
}

function levelForIndividualModes(modes: Modes): ComboLevel {
  return modes.caveman === 'off' && modes.rtk === 'off' && modes.ponytail === 'off' ? 'off' : 'custom';
}

function normalizedState(modes: Partial<Modes> | null | undefined, level: ComboLevel = deriveLevel(modes as Modes)): Readonly<ComboState> {
  const state: Modes = {
    caveman: normalizeMode('caveman', modes?.caveman) || 'off',
    rtk: normalizeMode('rtk', modes?.rtk) || 'off',
    ponytail: normalizeMode('ponytail', modes?.ponytail) || 'off',
  };
  return Object.freeze({ level: isKnownLevel(level) ? level : deriveLevel(state), ...state });
}

function bridge(): Bridge {
  const existing = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as Bridge | undefined;
  if (existing?.state) return existing;
  const initial = normalizedState((existing || COMBO_LEVELS.off) as Partial<Modes>);
  return ((globalThis as Record<symbol, unknown>)[BRIDGE_KEY] = { state: initial, listener: null });
}

function publish(state: Readonly<ComboState>): Readonly<ComboState> {
  const shared = bridge();
  shared.state = state;
  shared.listener?.(state);
  return state;
}

export function asPromptArray(systemPrompt: string | string[]): string[] {
  return Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt];
}

export function systemPromptIncludes(systemPrompt: string | string[], marker: string): boolean {
  return asPromptArray(systemPrompt).some((prompt) => typeof prompt === 'string' && prompt.includes(marker));
}

export function isOmpSubagentPrompt(systemPrompt: string | string[]): boolean {
  return systemPromptIncludes(systemPrompt, OMP_SUBAGENT_MARKER);
}

export function normalizeComboLevel(value: unknown): ComboLevel | null {
  const level = String(value || '').trim().toLowerCase();
  return isPresetLevel(level) ? level : null;
}

export function sessionEntries(ctx: ExtensionCtx | undefined): SessionEntry[] {
  return ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
}

export function getSharedComboState(): Readonly<ComboState> {
  return bridge().state;
}

export function isComboPresetActive(): boolean {
  const level = getSharedComboState().level;
  return level !== 'off' && isPresetLevel(level);
}

export function setSharedComboLevel(value: unknown): Readonly<ComboState> {
  const level = normalizeComboLevel(value) || 'off';
  return publish(normalizedState(COMBO_LEVELS[level] as Partial<Modes>, level));
}

export function setSharedComboMode(name: ModeName, value: unknown): Readonly<ComboState> {
  const mode = normalizeMode(name, value);
  if (!mode) return getSharedComboState();
  const modes = { ...getSharedComboState(), [name]: mode } as Modes;
  return publish(normalizedState(modes, levelForIndividualModes(modes)));
}

export function reconcileSharedComboEntries(entries: SessionEntry[] | null | undefined): Readonly<ComboState> {
  let modes: Modes = { ...COMBO_LEVELS.off };
  let level: ComboLevel = 'off';
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (entry?.type !== 'custom') continue;
      if (entry.customType === 'combo-level') {
        const preset = normalizeComboLevel(entry?.data?.level);
        if (preset) {
          modes = { ...COMBO_LEVELS[preset] };
          level = preset;
        }
        continue;
      }
      const name = entry.customType === 'caveman-mode'
        ? 'caveman'
        : entry.customType === 'rtk-mode'
          ? 'rtk'
          : entry.customType === 'ponytail-mode'
            ? 'ponytail'
            : null;
      if (!name) continue;
      const value = name === 'rtk' ? entry?.data?.enabled : entry?.data?.mode;
      const mode = normalizeMode(name, value);
      if (mode) {
        modes[name] = mode;
        level = levelForIndividualModes(modes);
      }
    }
  }
  return publish(normalizedState(modes, level));
}

export function setSharedComboListener(listener: ((state: Readonly<ComboState>) => void) | null): () => void {
  const shared = bridge();
  shared.listener = typeof listener === 'function' ? listener : null;
  return () => {
    if (shared.listener === listener) shared.listener = null;
  };
}

export function resetSharedComboState(): Readonly<ComboState> {
  return setSharedComboLevel('off');
}
