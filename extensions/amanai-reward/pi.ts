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
  messages?: AssistantMessage[];
}
interface NotifyCtx {
  hasUI?: boolean;
  ui?: {
    notify: (message: string, level?: string) => void;
  };
}

export default function amanaiRewardExtension(pi: ExtensionApi): void {
  let candidate = false;

  pi.on("agent_start", () => {
    candidate = false;
  });

  pi.on<AgentEndEvent>("agent_end", (event) => {
    candidate = false;

    const messages = Array.isArray(event?.messages) ? event.messages : [];
    let message: AssistantMessage | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") {
        message = messages[index];
        break;
      }
    }
    if (message?.stopReason !== "stop" || !Array.isArray(message.content)) return;

    candidate = message.content.some(
      (block) => block?.type === "text" && typeof block.text === "string" && REWARD_KEY.test(block.text),
    );
  });

  pi.on("agent_settled", (_event, ctx) => {
    const c = ctx as NotifyCtx | undefined;
    try {
      if (candidate && c?.hasUI && c.ui) c.ui.notify(NOTIFICATION, "info");
    } finally {
      candidate = false;
    }
  });
}
