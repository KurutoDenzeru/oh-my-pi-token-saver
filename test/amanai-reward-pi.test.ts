import test from "node:test";
import assert from "node:assert/strict";

import amanaiRewardExtension from "../extensions/amanai-reward/pi.js";
import type { ExtensionApi } from "../extensions/shared/types.js";

const NOTIFICATION = "Amanai reward key detected in the final response. Redeem it manually in the Amanai billing dashboard.";
const KEY = "AMANAI-GACHA-Alpha9-Reward42";

type EventHandler = (event: unknown, ctx: FakeCtx) => void;

interface FakeCtx {
  hasUI: boolean;
  ui?: { notify(message: string, level: string): void };
}

function instantiate() {
  const handlers = new Map<string, EventHandler>();
  amanaiRewardExtension({ on(event: string, handler: EventHandler) { handlers.set(event, handler); } } as unknown as ExtensionApi);
  assert.deepEqual([...handlers.keys()], ["agent_start", "agent_end", "agent_settled"]);
  return handlers;
}

function notificationContext(hasUI = true) {
  const notifications: [string, string][] = [];
  return {
    notifications,
    ctx: {
      hasUI,
      ui: { notify(message: string, level: string) { notifications.push([message, level]); } },
    },
  };
}

function finalAssistant(content: { type: string; text?: string }[], stopReason = "stop") {
  return { messages: [{ role: "assistant", stopReason, content }] };
}

test("waits for settlement before notifying once about a final reward key without mutating the event", () => {
  const handlers = instantiate();
  const { ctx, notifications } = notificationContext();
  const event = Object.freeze({
    messages: Object.freeze([
      Object.freeze({
        role: "assistant",
        stopReason: "stop",
        content: Object.freeze([Object.freeze({ type: "text", text: "Earlier response." })]),
      }),
      Object.freeze({
        role: "assistant",
        stopReason: "stop",
        content: Object.freeze([Object.freeze({ type: "text", text: `Reward: ${KEY}` })]),
      }),
    ]),
  });
  const before = JSON.stringify(event);

  handlers.get("agent_end")!(event, ctx);
  assert.deepEqual(notifications, []);
  assert.equal(JSON.stringify(event), before);

  handlers.get("agent_settled")!({}, ctx);
  assert.deepEqual(notifications, [[NOTIFICATION, "info"]]);

  handlers.get("agent_settled")!({}, ctx);
  assert.deepEqual(notifications, [[NOTIFICATION, "info"]]);
});

test("rejects keyless, non-stop, non-text, and non-final reward candidates", () => {
  const handlers = instantiate();
  const { ctx, notifications } = notificationContext();
  const cases = [
    finalAssistant([{ type: "text", text: "No reward." }]),
    finalAssistant([{ type: "text", text: KEY }], "length"),
    finalAssistant([{ type: "text", text: `x${KEY}_suffix` }]),
    {
      messages: [
        { role: "assistant", stopReason: "stop", content: [{ type: "text", text: KEY }] },
        { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "No reward." }] },
      ],
    },
  ];

  for (const event of cases) {
    handlers.get("agent_end")!(event, ctx);
    handlers.get("agent_settled")!({}, ctx);
  }

  assert.deepEqual(notifications, []);
});

test("a later agent end clears an earlier reward candidate before applying guards", () => {
  const handlers = instantiate();
  const { ctx, notifications } = notificationContext();

  handlers.get("agent_end")!(finalAssistant([{ type: "text", text: KEY }]), ctx);
  handlers.get("agent_end")!(finalAssistant([{ type: "text", text: "No reward." }]), ctx);
  handlers.get("agent_settled")!({}, ctx);

  assert.deepEqual(notifications, []);
});

test("agent start clears a pending reward candidate", () => {
  const handlers = instantiate();
  const { ctx, notifications } = notificationContext();

  handlers.get("agent_end")!(finalAssistant([{ type: "text", text: KEY }]), ctx);
  handlers.get("agent_start")!({}, ctx);
  handlers.get("agent_settled")!({}, ctx);

  assert.deepEqual(notifications, []);
});

test("settlement without UI clears a pending candidate without notifying", () => {
  const handlers = instantiate();
  const withoutUI = { hasUI: false };
  const withUI = notificationContext();

  handlers.get("agent_end")!(finalAssistant([{ type: "text", text: KEY }]), withoutUI);
  handlers.get("agent_settled")!({}, withoutUI);
  handlers.get("agent_settled")!({}, withUI.ctx);

  assert.deepEqual(withUI.notifications, []);
});
