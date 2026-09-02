import { reconcileSharedComboEntries } from "./session-state.js";
import type { ExtensionApi, ExtensionCtx, SystemPromptEvent } from "./types.js";

const MARKER = "SUPREME TOKEN SAVER MODES ACTIVE";

function entriesFrom(ctx: ExtensionCtx | undefined) {
  return ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
}

function instruction(state: { caveman: string; rtk: string; ponytail: string }): string | null {
  const modes = [
    state.caveman !== "off" && `caveman=${state.caveman}`,
    state.rtk === "on" && "rtk=on",
    state.ponytail !== "off" && `ponytail=${state.ponytail}`,
  ].filter(Boolean);
  if (!modes.length) return null;

  return `${MARKER}: ${modes.join(" · ")}. Keep these active for the entire response: concise Caveman prose, RTK for eligible noisy shell output, and the smallest correct Ponytail solution. Do not weaken or disable a mode unless the user explicitly asks.`;
}

export default function modeReinforcementExtension(pi: ExtensionApi): void {
  pi.setLabel?.("Token Saver mode reinforcement");

  pi.on("before_agent_start", async (event: SystemPromptEvent, ctx) => {
    if (!ctx?.hasUI) return;
    const text = instruction(reconcileSharedComboEntries(entriesFrom(ctx)));
    if (!text) return;

    const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [event.systemPrompt];
    if (base.some((prompt) => typeof prompt === "string" && prompt.includes(MARKER))) return;
    return { systemPrompt: [...base, text] };
  });
}
