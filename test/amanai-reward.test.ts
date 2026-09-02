import test from "node:test";
import assert from "node:assert/strict";

import amanaiRewardExtension from "../extensions/amanai-reward/index.js";
import type { ExtensionApi } from "../extensions/shared/types.js";
const NOTIFICATION = "Amanai reward key detected in the final response. Redeem it manually in the Amanai billing dashboard.";
const KEY = "AMANAI-GACHA-Alpha9-Reward42";

type EventHandler = (event: unknown, ctx: FakeCtx) => void;

interface FakePi {
  handlers: Map<string, EventHandler>;
  registrations: string[];
  on(event: string, handler: EventHandler): void;
}

interface FakeCtx {
  ui: { notify(message: string, level: string): void };
}

type Content = { type: string; text?: string; id?: string }[];

function fakePi(): FakePi {
  const handlers = new Map<string, EventHandler>();
  const registrations: string[] = [];
  return {
    handlers,
    registrations,
    on(event, handler) {
      registrations.push(event);
      handlers.set(event, handler);
    },
  };
}

function notificationContext() {
  const notifications: [string, string][] = [];
  return {
    notifications,
    ctx: { ui: { notify(message: string, level: string) { notifications.push([message, level]); } } },
  };
}

function finalAssistant(content: Content, stopReason = "stop") {
  return { messages: [{ role: "assistant", stopReason, content }] };
}

function instantiate(): EventHandler {
  const pi = fakePi();
  amanaiRewardExtension(pi as unknown as ExtensionApi);
  assert.deepEqual(pi.registrations, ["agent_end"]);
  return pi.handlers.get("agent_end")!;
}

test("detects a standalone Amanai key in the final successful assistant response", () => {
  const handler = instantiate();
  const { ctx, notifications } = notificationContext();
  const event = finalAssistant([{ type: "text", text: `Reward: ${KEY}` }]);
  const before = JSON.stringify(event);

  handler(event, ctx);

  assert.deepEqual(notifications, [[NOTIFICATION, "info"]]);
  assert.equal(JSON.stringify(event), before);
});

test("does not notify for guard conditions", () => {
  const handler = instantiate();
  const cases = [
    ["continuing response", { ...finalAssistant([{ type: "text", text: KEY }]), willContinue: true }],
    ["missing messages", {}],
    ["no assistant message", { messages: [{ role: "user", content: [{ type: "text", text: KEY }] }] }],
    ["invalid assistant message", { messages: [{ role: "assistant", stopReason: "stop" }] }],
    ["non-stop termination", finalAssistant([{ type: "text", text: KEY }], "length")],
    ["only an embedded key", finalAssistant([{ type: "text", text: `x${KEY}_suffix` }])],
    ["non-text-only content", finalAssistant([{ type: "toolCall", id: KEY }])],
    [
      "an earlier assistant key but no key in the last assistant response",
      { messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: KEY }] }, { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "No reward." }] }] },
    ],
  ];

  for (const [, event] of cases) {
    const { ctx, notifications } = notificationContext();
    handler(event, ctx);
    assert.deepEqual(notifications, []);
  }
});
