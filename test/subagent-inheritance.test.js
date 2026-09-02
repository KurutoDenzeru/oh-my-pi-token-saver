import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import cavemanSessionExtension from "../extensions/caveman-session/index.js";
import comboToggleExtension from "../extensions/combo-toggle/index.js";
import rtkSessionExtension from "../extensions/rtk-session/index.js";
import {
  OMP_SUBAGENT_MARKER,
  getSharedComboState,
  resetSharedComboState,
} from "../extensions/shared/session-state.js";

const MARKED_PROMPT = `System instructions.\n${OMP_SUBAGENT_MARKER}`;
const UNMARKED_PROMPT = "System instructions for an unrelated headless session.";

function fakePi(sessionEntries = []) {
  const commands = new Map();
  const handlers = new Map();
  const chain = { min: () => chain, describe: () => chain };
  return {
    commands,
    handlers,
    zod: { z: { object: () => ({}), array: () => chain, string: () => ({}) } },
    setLabel() {},
    registerCommand(name, config) { commands.set(name, config.handler); },
    registerTool() {},
    on(event, handler) { handlers.set(event, handler); },
    appendEntry(customType, data) { sessionEntries.push({ type: "custom", customType, data }); },
  };
}

function context(entries = [], hasUI = false) {
  const statuses = new Map();
  const notifications = [];
  return {
    hasUI,
    statuses,
    notifications,
    sessionManager: { getBranch: () => entries },
    ui: {
      setStatus(name, value) { statuses.set(name, value); },
      notify(message) { notifications.push(message); },
    },
    async reload() {},
  };
}

function instantiate(factory, entries = []) {
  const pi = fakePi(entries);
  factory(pi);
  return pi;
}

async function command(pi, name, value, ctx) {
  await pi.commands.get(name)(value, ctx);
}

async function inject(pi, systemPrompt, ctx) {
  return pi.handlers.get("before_agent_start")({ systemPrompt }, ctx);
}

function instruction(result) {
  return result?.systemPrompt?.at(-1) || "";
}

async function withoutInstalledPonytail(callback) {
  const missingHome = fileURLToPath(new URL("./definitely-missing-home", import.meta.url));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = missingHome;
  process.env.USERPROFILE = missingHome;
  try {
    return await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("parent Combo max is inherited by separately instantiated marked children", async () => {
  resetSharedComboState();
  const entries = [];
  const parent = instantiate(comboToggleExtension, entries);
  await command(parent, "combo", "max", context(entries, true));
  const childCaveman = instantiate(cavemanSessionExtension);
  const childRtk = instantiate(rtkSessionExtension);
  const childCombo = instantiate(comboToggleExtension);

  assert.deepEqual(getSharedComboState(), {
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra",
  });
  assert.match(instruction(await inject(childCaveman, MARKED_PROMPT)), /Caveman ultra active/);
  assert.match(instruction(await inject(childRtk, MARKED_PROMPT)), /RTK mode active/);

  const ponytail = instruction(await withoutInstalledPonytail(() => inject(childCombo, MARKED_PROMPT)));
  assert.match(ponytail, /PONYTAIL MODE ACTIVE — level: ultra/);
  assert.match(ponytail, /root cause/i);
  assert.match(ponytail, /Standard library/i);
  assert.match(ponytail, /YAGNI/);
  assert.match(ponytail, /Verify/);
});

test("medium maps to Caveman lite, RTK on, and Ponytail lite", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "medium", context([], true));
  const prompt = ["System instructions.", OMP_SUBAGENT_MARKER];

  assert.deepEqual(getSharedComboState(), {
    level: "medium", caveman: "lite", rtk: "on", ponytail: "lite",
  });
  assert.match(instruction(await inject(instantiate(cavemanSessionExtension), prompt)), /Caveman lite active/);
  assert.match(instruction(await inject(instantiate(rtkSessionExtension), prompt)), /RTK mode active/);
  assert.match(
    instruction(await withoutInstalledPonytail(() => inject(instantiate(comboToggleExtension), prompt))),
    /PONYTAIL MODE ACTIVE — level: lite/
  );
});

test("Combo off gives marked children no inherited guidance", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  const ctx = context([], true);
  await command(parent, "combo", "max", ctx);
  await command(parent, "combo", "off", ctx);

  assert.deepEqual(getSharedComboState(), {
    level: "off", caveman: "off", rtk: "off", ponytail: "off",
  });
  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    assert.equal(await inject(instantiate(factory), MARKED_PROMPT), undefined);
  }
});

test("unmarked headless prompts never inherit active parent modes", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    const child = instantiate(factory);
    await child.handlers.get("session_start")?.({}, context([], false));
    assert.equal(await inject(child, UNMARKED_PROMPT), undefined);
  }
});

test("headless child session_start cannot reset the parent bridge", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const childCombo = instantiate(comboToggleExtension);

  await childCombo.handlers.get("session_start")({}, context([], false));

  assert.equal(getSharedComboState().level, "max");
  assert.match(
    instruction(await withoutInstalledPonytail(() => inject(childCombo, MARKED_PROMPT))),
    /level: ultra/
  );
});

test("interactive top-level session_start with no entries resets bridge off", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const nextSession = instantiate(comboToggleExtension);

  await nextSession.handlers.get("session_start")({}, context([], true));

  assert.equal(getSharedComboState().level, "off");
  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    assert.equal(await inject(instantiate(factory), MARKED_PROMPT), undefined);
  }
});

test("individual Caveman change immediately makes Combo CUSTOM and children inherit actual mix", async () => {
  resetSharedComboState();
  const entries = [];
  const combo = instantiate(comboToggleExtension, entries);
  const comboCtx = context(entries, true);
  await command(combo, "combo", "max", comboCtx);
  const caveman = instantiate(cavemanSessionExtension, entries);

  await command(caveman, "caveman", "lite", context(entries, true));

  assert.deepEqual(getSharedComboState(), {
    level: "custom", caveman: "lite", rtk: "on", ponytail: "ultra",
  });
  assert.match(comboCtx.statuses.get("combo"), /combo: CUSTOM/);
  assert.match(comboCtx.statuses.get("combo"), /caveman=LITE/);
  assert.match(instruction(await inject(instantiate(cavemanSessionExtension), MARKED_PROMPT)), /Caveman lite active/);
  assert.match(instruction(await inject(instantiate(rtkSessionExtension), MARKED_PROMPT)), /RTK mode active/);
  assert.match(
    instruction(await withoutInstalledPonytail(() => inject(instantiate(comboToggleExtension), MARKED_PROMPT))),
    /level: ultra/
  );

  await command(caveman, "caveman", "ultra", context(entries, true));
  assert.equal(getSharedComboState().level, "max");
  assert.match(comboCtx.statuses.get("combo"), /combo: MAX/);
});

test("individual RTK change makes Combo CUSTOM and realignment restores exact preset", async () => {
  resetSharedComboState();
  const entries = [];
  const combo = instantiate(comboToggleExtension, entries);
  const comboCtx = context(entries, true);
  await command(combo, "combo", "max", comboCtx);
  const rtk = instantiate(rtkSessionExtension, entries);

  await command(rtk, "rtk", "off", context(entries, true));

  assert.deepEqual(getSharedComboState(), {
    level: "custom", caveman: "ultra", rtk: "off", ponytail: "ultra",
  });
  assert.match(comboCtx.statuses.get("combo"), /combo: CUSTOM/);
  assert.equal(await inject(instantiate(rtkSessionExtension), MARKED_PROMPT), undefined);

  await command(rtk, "rtk", "on", context(entries, true));
  assert.equal(getSharedComboState().level, "max");
  assert.match(comboCtx.statuses.get("combo"), /combo: MAX/);
});

test("Combo status reconciles latest persisted Ponytail mode and reports actual values", async () => {
  resetSharedComboState();
  const entries = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);
  await command(combo, "combo", "max", ctx);
  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } });

  await command(combo, "combo", "status", ctx);

  assert.deepEqual(getSharedComboState(), {
    level: "custom", caveman: "ultra", rtk: "on", ponytail: "lite",
  });
  assert.equal(ctx.notifications.at(-1), "Combo: CUSTOM (caveman=ultra rtk=on ponytail=lite)");
  assert.match(
    instruction(await withoutInstalledPonytail(() => inject(instantiate(comboToggleExtension), MARKED_PROMPT))),
    /level: lite/
  );
});

test("Combo does not duplicate existing Ponytail guidance", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "medium", context([], true));
  const prompt = [OMP_SUBAGENT_MARKER, "PONYTAIL MODE ACTIVE — level: lite"];

  assert.equal(await inject(instantiate(comboToggleExtension), prompt), undefined);
});
