// /headroom toggle + /ai-addons update headroom: exec routing, dry-run
// previews, and already-on/off short-circuits — all with a fake HOME and a
// fake `headroom` CLI so no network or real wrap ever happens.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const updaterPath = path.join(root, "extensions", "ai-addons-updater", "index.js");
const updaterUrl = new URL("file:///" + updaterPath.replace(/\\/g, "/"));

const { default: updaterExtension } = await import(updaterUrl.href);

const CLOSED_PORT = 1;

type CommandHandler = (args: string, ctx: FakeCtx) => Promise<string>;
interface FakeCtx {
  cwd: string;
  ui: { notify(): void };
}
interface ExecCall {
  cmd: string;
  args: string[];
}

function wrappedModels(port: number): string {
  return `# managed by \`headroom wrap omp\`\nproviders:\n  anthropic:\n    baseUrl: http://127.0.0.1:${port}\n`;
}

function fakeHome(modelsBody: string | null): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "omp-headroom-cmd-"));
  if (modelsBody !== null) {
    mkdirSync(path.join(dir, ".omp", "agent"), { recursive: true });
    writeFileSync(path.join(dir, ".omp", "agent", "models.yml"), modelsBody);
  }
  return dir;
}

async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    return await fn();
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
    if (prevAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  }
}

function harness(execImpl: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>): {
  calls: ExecCall[];
  handlers: Map<string, CommandHandler>;
  ctx: FakeCtx;
} {
  const calls: ExecCall[] = [];
  const handlers = new Map<string, CommandHandler>();
  const pi = {
    setLabel: () => { },
    registerCommand: (name: string, config: { handler: CommandHandler }) => {
      handlers.set(name, config.handler);
    },
    exec: async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return execImpl(cmd, args);
    },
  };
  updaterExtension(pi);
  return { calls, handlers, ctx: { cwd: os.tmpdir(), ui: { notify: () => { } } } };
}

const fakeCli = (_cmd: string, _args: string[]): Promise<{ stdout: string; stderr: string; code: number }> =>
  Promise.resolve({ stdout: "headroom 0.37.0", stderr: "", code: 0 });

test("/headroom on --dry-run previews the prepare-only wrap without exec", async () => {
  const home = fakeHome(null);
  try {
    await withHome(home, async () => {
      const { calls, handlers, ctx } = harness(fakeCli);
      const result = await handlers.get("headroom")!("on --dry-run", ctx);
      assert.equal(calls.length, 0);
      assert.match(result, /headroom wrap omp --prepare-only/);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("/headroom off --dry-run previews unwrap without exec", async () => {
  const home = fakeHome(wrappedModels(CLOSED_PORT));
  try {
    await withHome(home, async () => {
      const { calls, handlers, ctx } = harness(fakeCli);
      const result = await handlers.get("headroom")!("off --dry-run", ctx);
      assert.equal(calls.length, 0);
      assert.match(result, /headroom unwrap omp/);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("/headroom reports already-off without exec when not wrapped", async () => {
  const home = fakeHome(null);
  try {
    await withHome(home, async () => {
      const { calls, handlers, ctx } = harness(fakeCli);
      const result = await handlers.get("headroom")!("off", ctx);
      assert.equal(calls.length, 0);
      assert.match(result, /already off/i);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("/headroom on runs version check then prepare-only wrap", async () => {
  const home = fakeHome(null);
  try {
    await withHome(home, async () => {
      const { calls, handlers, ctx } = harness(fakeCli);
      const result = await handlers.get("headroom")!("on", ctx);
      assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]), [
        ["headroom", "--version"],
        ["headroom", "wrap", "omp", "--prepare-only"],
      ]);
      assert.match(result, /Headroom on/i);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("/headroom on reports already-on without exec when wrapped", async () => {
  const home = fakeHome(wrappedModels(CLOSED_PORT));
  try {
    await withHome(home, async () => {
      const { calls, handlers, ctx } = harness(fakeCli);
      const result = await handlers.get("headroom")!("on", ctx);
      assert.equal(calls.length, 0);
      assert.match(result, /already on/i);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("/headroom status shows CLI version and wrap state", async () => {
  const home = fakeHome(null);
  try {
    await withHome(home, async () => {
      const { handlers, ctx } = harness(fakeCli);
      const result = await handlers.get("headroom")!("status", ctx);
      assert.match(result, /0\.37\.0/);
      assert.match(result, /not wrapped/i);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("/headroom rejects unknown subcommands with usage", async () => {
  const home = fakeHome(null);
  try {
    await withHome(home, async () => {
      const { calls, handlers, ctx } = harness(fakeCli);
      const result = await handlers.get("headroom")!("sideways", ctx);
      assert.equal(calls.length, 0);
      assert.match(result, /Usage: \/headroom/);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("/ai-addons update headroom --dry-run previews without exec", async () => {
  const home = fakeHome(null);
  try {
    await withHome(home, async () => {
      const { calls, handlers, ctx } = harness(fakeCli);
      const result = await handlers.get("ai-addons")!("update headroom --dry-run", ctx);
      assert.equal(calls.length, 0);
      assert.match(result, /headroom update/);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("/ai-addons update headroom runs headroom update via exec", async () => {
  const home = fakeHome(null);
  try {
    await withHome(home, async () => {
      const { calls, handlers, ctx } = harness(async (_cmd, args) => {
        if (args[0] === "--version") return { stdout: "headroom 0.37.0", stderr: "", code: 0 };
        return { stdout: "already latest", stderr: "", code: 0 };
      });
      const result = await handlers.get("ai-addons")!("update headroom", ctx);
      assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]), [
        ["headroom", "--version"],
        ["headroom", "update"],
      ]);
      assert.match(result, /Headroom update finished/i);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("/ai-addons update headroom prints install hint when CLI missing", async () => {
  const home = fakeHome(null);
  try {
    await withHome(home, async () => {
      const { calls, handlers, ctx } = harness(async () => ({ stdout: "", stderr: "not found", code: 127 }));
      const result = await handlers.get("ai-addons")!("update headroom", ctx);
      assert.equal(calls.length, 1);
      assert.match(result, /CLI not found/);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
