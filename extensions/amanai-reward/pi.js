const REWARD_KEY = /(?<![A-Za-z0-9_-])AMANAI-GACHA-[A-Za-z0-9]+-[A-Za-z0-9]+(?![A-Za-z0-9_-])/;
const NOTIFICATION = "Amanai reward key detected in the final response. Redeem it manually in the Amanai billing dashboard.";

export default function amanaiRewardExtension(pi) {
  let candidate = false;

  pi.on("agent_start", () => {
    candidate = false;
  });

  pi.on("agent_end", (event) => {
    candidate = false;

    const messages = Array.isArray(event?.messages) ? event.messages : [];
    let message;
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
    try {
      candidate && ctx.hasUI && ctx.ui.notify(NOTIFICATION, "info");
    } finally {
      candidate = false;
    }
  });
}
