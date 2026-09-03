// Headroom proxy presence for the combo status bar.
// Wrap-marker read is sync so paint stays cheap; proxy /health is probed async,
// cached per port, and callers repaint when the probe settles.
import { readFileSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

export const HEADROOM_MARKER = "# managed by `headroom wrap omp`";

export type HeadroomStatus = "off" | "on" | "stale";

const PROBE_TTL_MS = 60_000;

function modelsPath(): string {
  const base = process.env.PI_CODING_AGENT_DIR?.trim();
  if (base) return path.join(path.resolve(base), "models.yml");
  return path.join(os.homedir(), ".omp", "agent", "models.yml");
}

export function readHeadroomWrap(): { wrapped: boolean; port: number | null } {
  let raw: string;
  try {
    raw = readFileSync(modelsPath(), "utf8");
  } catch {
    return { wrapped: false, port: null };
  }
  if (!raw.includes(HEADROOM_MARKER)) return { wrapped: false, port: null };
  const match = raw.match(/baseUrl:\s*https?:\/\/127\.0\.0\.1:(\d+)/);
  return { wrapped: true, port: match ? Number(match[1]) : null };
}

function probeProxy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get({ host: "127.0.0.1", port, path: "/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

let lastPort: number | null | undefined;
let lastHealthy = true;
let lastProbeAt = 0;
let inflight: Promise<void> | null = null;

export function refreshHeadroomStatus(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { wrapped, port } = readHeadroomWrap();
    if (!wrapped || port === null) {
      lastPort = port;
      lastHealthy = true;
      lastProbeAt = Date.now();
      return;
    }
    lastHealthy = await probeProxy(port);
    lastPort = port;
    lastProbeAt = Date.now();
  })();
  inflight.then(
    () => { inflight = null; },
    () => { inflight = null; },
  );
  return inflight;
}

export function getHeadroomStatus(): HeadroomStatus {
  const { wrapped, port } = readHeadroomWrap();
  if (!wrapped) return "off";
  if (port !== null && port === lastPort && Date.now() - lastProbeAt < PROBE_TTL_MS) {
    return lastHealthy ? "on" : "stale";
  }
  // No fresh probe for this port: kick one off and assume on until a probe
  // says otherwise, so first paint never blocks on the network.
  void refreshHeadroomStatus();
  return port !== null && port === lastPort && !lastHealthy ? "stale" : "on";
}
