// Status-bar ownership regression: while a Combo preset is active, the combo bar
// is the only status line — caveman and rtk must not paint their own bars
// alongside it. This regressed when the `balanced` preset was added: caveman and
// rtk's suppression checks hardcoded medium/max, so balanced leaked through and
// the status bar showed both `🪨 caveman: FULL` and the combo bar.
import test from "node:test";
import assert from "node:assert/strict";

import cavemanSessionExtension from "../extensions/caveman-session/index.js";
import comboToggleExtension from "../extensions/combo-toggle/index.js";
import rtkSessionExtension from "../extensions/rtk-session/index.js";
import { resetSharedComboState } from "../extensions/shared/session-state.js";
import type { ExtensionApi, ExtensionCtx, SessionEntry } from "../extensions/shared/types.js";

interface Harness {
  statuses: Map<string, string>;
  entries: SessionEntry[];
  pi: { combo: ExtensionApi; caveman: ExtensionApi; rtk: ExtensionApi; handlers: Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>> };
  ctx: ExtensionCtx;
}

function harness(): Harness {
  const statuses = new Map<string, string>();
  const entries: SessionEntry[] = [];
  const mk = (): ExtensionApi & { handlers: Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>; commands: Map<string, (arg: string, ctx: ExtensionCtx) => Promise<unknown>> } => {
    const handlers = new Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>();
    const commands = new Map<string, (arg: string, ctx: ExtensionCtx) => Promise<unknown>>();
    return {
      handlers,
      commands,
      setLabel: () => {},
      registerCommand: (name, config) => { commands.set(name, config.handler as (arg: string, ctx: ExtensionCtx) => Promise<unknown>); },
      registerTool: () => {},
      on: (event, handler) => { handlers.set(event, handler as (event: unknown, ctx: ExtensionCtx) => Promise<unknown>); },
      appendEntry: (customType, data) => { entries.push({ type: "custom", customType, data } as SessionEntry); },
      zod: { z: { object: (shape) => shape, array: () => ({ min: () => ({ describe: () => ({}) }) }), string: () => ({}) } },
    } as unknown as ExtensionApi & typeof handlers & { commands: typeof commands };
  };
  const pi = { combo: mk(), caveman: mk(), rtk: mk(), handlers: new Map() };
  const ctx = {
    hasUI: true,
    ui: {
      setStatus: (key: string, value?: string) => { if (value === undefined) statuses.delete(key); else statuses.set(key, value); },
      notify: () => {},
    },
    sessionManager: { getBranch: () => entries },
  } as unknown as ExtensionCtx;
  comboToggleExtension(pi.combo);
  cavemanSessionExtension(pi.caveman);
  rtkSessionExtension(pi.rtk);
  return { statuses, entries, pi, ctx };
}

test("combo balanced suppresses the individual caveman and rtk bars", async () => {
  resetSharedComboState();
  const { statuses, pi, ctx } = harness();
  await pi.combo.handlers.get("session_start")!({}, ctx);
  await pi.caveman.handlers.get("session_start")!({}, ctx);
  await pi.rtk.handlers.get("session_start")!({}, ctx);

  await pi.combo.commands.get("combo")!("balanced", ctx);
  assert.ok(statuses.has("combo"), "combo bar present");
  assert.doesNotMatch(statuses.get("combo") || "", /caveman: FULL/);

  // The race that surfaced the bug: caveman/rtk reconcile after combo paints.
  await pi.caveman.handlers.get("agent_start")!({}, ctx);
  await pi.rtk.handlers.get("agent_start")!({}, ctx);
  assert.deepEqual([...statuses.keys()], ["combo"], "combo bar is the only status line under balanced");
  assert.match(statuses.get("combo") || "", /BALANCED/);
  resetSharedComboState();
});

test("every preset suppresses individual bars; off and custom behave correctly", async () => {
  for (const preset of ["medium", "balanced", "max"] as const) {
    resetSharedComboState();
    const h = harness();
    await h.pi.combo.handlers.get("session_start")!({}, h.ctx);
    await h.pi.caveman.handlers.get("session_start")!({}, h.ctx);
    await h.pi.rtk.handlers.get("session_start")!({}, h.ctx);
    await h.pi.combo.commands.get("combo")!(preset, h.ctx);
    await h.pi.caveman.handlers.get("agent_start")!({}, h.ctx);
    await h.pi.rtk.handlers.get("agent_start")!({}, h.ctx);
    assert.deepEqual([...h.statuses.keys()], ["combo"], `${preset} leaves only the combo bar`);
  }

  // /combo off persists caveman=off + rtk=off: everything off, no bars.
  resetSharedComboState();
  const off = harness();
  await off.pi.combo.handlers.get("session_start")!({}, off.ctx);
  await off.pi.caveman.handlers.get("session_start")!({}, off.ctx);
  await off.pi.rtk.handlers.get("session_start")!({}, off.ctx);
  await off.pi.combo.commands.get("combo")!("off", off.ctx);
  await off.pi.caveman.handlers.get("agent_start")!({}, off.ctx);
  await off.pi.rtk.handlers.get("agent_start")!({}, off.ctx);
  assert.equal(off.statuses.size, 0, "combo off turns everything off: no bars");

  // Custom mix (individual modes set, combo inactive): individual bars return.
  resetSharedComboState();
  const custom = harness();
  await custom.pi.combo.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.caveman.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.rtk.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.caveman.commands.get("caveman")!("full", custom.ctx);
  await custom.pi.rtk.commands.get("rtk")!("on", custom.ctx);
  await custom.pi.combo.handlers.get("agent_start")!({}, custom.ctx);
  assert.ok(!custom.statuses.has("combo"), "no combo bar for a custom mix");
  assert.ok(custom.statuses.has("caveman") && custom.statuses.has("rtk"), "individual bars restored for a custom mix");
  resetSharedComboState();
});
