// Combo bar headroom segment: 🗜️headroom=ON while models.yml is
// headroom-wrapped, STALE when the wrapped proxy is down, absent otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import comboToggleExtension from "../extensions/combo-toggle/index.js";
import { refreshHeadroomStatus } from "../extensions/shared/headroom-status.js";
import { resetSharedComboState } from "../extensions/shared/session-state.js";
import type { ExtensionApi, ExtensionCtx, SessionEntry } from "../extensions/shared/types.js";

const CLOSED_PORT = 1;

function wrappedModels(port: number): string {
  return `# managed by \`headroom wrap omp\`\nproviders:\n  anthropic:\n    baseUrl: http://127.0.0.1:${port}\n`;
}

function fakeHome(modelsBody: string | null): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "omp-headroom-bar-"));
  if (modelsBody !== null) {
    mkdirSync(path.join(dir, ".omp", "agent"), { recursive: true });
    writeFileSync(path.join(dir, ".omp", "agent", "models.yml"), modelsBody);
  }
  return dir;
}

async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await fn();
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
  }
}

function harness(): {
  statuses: Map<string, string>;
  handlers: Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>;
  commands: Map<string, (arg: string, ctx: ExtensionCtx) => Promise<unknown>>;
  ctx: ExtensionCtx;
} {
  const statuses = new Map<string, string>();
  const entries: SessionEntry[] = [];
  const handlers = new Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>();
  const commands = new Map<string, (arg: string, ctx: ExtensionCtx) => Promise<unknown>>();
  const pi = {
    setLabel: () => { },
    registerCommand: (name: string, config: { handler: (arg: string, ctx: ExtensionCtx) => Promise<unknown> }) => {
      commands.set(name, config.handler);
    },
    registerTool: () => { },
    on: (event: string, handler: (event: unknown, ctx: ExtensionCtx) => Promise<unknown>) => {
      handlers.set(event, handler);
    },
    appendEntry: (customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data } as SessionEntry);
    },
    zod: { z: { object: (shape: unknown) => shape, array: () => ({ min: () => ({ describe: () => ({}) }) }), string: () => ({}) } },
  } as unknown as ExtensionApi;
  const ctx = {
    hasUI: true,
    ui: {
      setStatus: (key: string, value?: string) => {
        if (value === undefined) statuses.delete(key);
        else statuses.set(key, value);
      },
      notify: () => { },
    },
    sessionManager: { getBranch: () => entries },
  } as unknown as ExtensionCtx;
  comboToggleExtension(pi);
  return { statuses, handlers, commands, ctx };
}

test("combo bar shows headroom=ON when models.yml is headroom-wrapped", async () => {
  const home = fakeHome(wrappedModels(CLOSED_PORT));
  try {
    await withHome(home, async () => {
      resetSharedComboState();
      const { statuses, handlers, commands, ctx } = harness();
      await handlers.get("session_start")!({}, ctx);
      await commands.get("combo")!("balanced", ctx);
      assert.match(statuses.get("combo") || "", /🗜️headroom=ON/);
      resetSharedComboState();
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("combo bar omits headroom when models.yml is not wrapped", async () => {
  const home = fakeHome(null);
  try {
    await withHome(home, async () => {
      resetSharedComboState();
      const { statuses, handlers, commands, ctx } = harness();
      await handlers.get("session_start")!({}, ctx);
      await commands.get("combo")!("balanced", ctx);
      assert.match(statuses.get("combo") || "", /BALANCED/);
      assert.doesNotMatch(statuses.get("combo") || "", /headroom/);
      resetSharedComboState();
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("combo bar shows headroom=STALE when the wrapped proxy is down", async () => {
  const home = fakeHome(wrappedModels(CLOSED_PORT));
  try {
    await withHome(home, async () => {
      resetSharedComboState();
      const { statuses, handlers, commands, ctx } = harness();
      await handlers.get("session_start")!({}, ctx);
      await commands.get("combo")!("balanced", ctx);
      await refreshHeadroomStatus();
      await handlers.get("agent_start")!({}, ctx);
      assert.match(statuses.get("combo") || "", /🗜️headroom=STALE/);
      resetSharedComboState();
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
