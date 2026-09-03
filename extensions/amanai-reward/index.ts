import type { ExtensionApi, ExtensionCtx } from "../shared/types.ts";

const REWARD_KEY = /(?<![A-Za-z0-9_-])AMANAI-GACHA-[A-Za-z0-9]+-[A-Za-z0-9]+(?![A-Za-z0-9_-])/;
const NOTIFICATION = "Amanai reward key detected in the final response. Redeem it manually in the Amanai billing dashboard.";

interface ContentBlock {
  type?: string;
  text?: string;
}

interface AssistantMessage {
  role?: string;
  stopReason?: string;
  content?: ContentBlock[];
}

interface AgentEndEvent {
  willContinue?: boolean;
  messages?: AssistantMessage[];
}

interface NotifyUi {
  notify?: (message: string, level?: string) => void;
}

export default function amanaiRewardExtension(pi: ExtensionApi): void {
  pi.on<AgentEndEvent>("agent_end", (event, ctx) => {
    if (event.willContinue) return;

    const messages = Array.isArray(event.messages) ? event.messages : [];
    let message: AssistantMessage | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") {
        message = messages[index];
        break;
      }
    }
    if (!message || message.stopReason !== "stop" || !Array.isArray(message.content)) return;

    for (const block of message.content) {
      if (block?.type === "text" && typeof block.text === "string" && REWARD_KEY.test(block.text)) {
        (ctx as { ui?: NotifyUi } | undefined)?.ui?.notify?.(NOTIFICATION, "info");
        return;
      }
    }

  });
}
