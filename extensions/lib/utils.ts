// Shared helpers for the installer and the AI add-ons updater.
// Node built-ins only — this module must stay dependency-free.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";

export interface HttpGetOptions {
  maxRedirects?: number;
}

export interface HttpDownloadOptions {
  maxRedirects?: number;
}

// Promise.withResolvers is Node 22+; the package supports Node 18+.
// ponytail: swap for the built-in when engines bumps to >=22.
function withResolvers<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function httpsGet(url: string, opts: HttpGetOptions = {}): Promise<string> {
  const { promise, resolve, reject } = withResolvers<string>();
  const maxRedirects = opts.maxRedirects ?? 5;
  const req = https.get(url, { headers: { "User-Agent": "omp-token-saver", Accept: "application/json,*/*" } }, (res) => {
    if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      if (maxRedirects <= 0) { res.resume(); reject(new Error(`Too many redirects fetching ${url}`)); return; }
      res.resume();
      const next = new URL(res.headers.location, url).href;
      resolve(httpsGet(next, { maxRedirects: maxRedirects - 1 }));
      return;
    }
    if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
    let body = "";
    // ponytail: streamed accumulation — fine for tens of KB; stream-pipe if assets ever exceed a few MB.
    res.setEncoding("utf8");
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => resolve(body));
  });
  req.on("error", reject);
  req.setTimeout(30000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
  return promise;
}

export function httpsDownload(url: string, dest: string, opts: HttpDownloadOptions = {}): Promise<void> {
  const { promise, resolve, reject } = withResolvers<void>();
  const maxRedirects = opts.maxRedirects ?? 5;
  const req = https.get(url, { headers: { "User-Agent": "omp-token-saver", Accept: "*/*" } }, (res) => {
    if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      if (maxRedirects <= 0) { res.resume(); reject(new Error(`Too many redirects downloading ${url}`)); return; }
      res.resume();
      const next = new URL(res.headers.location, url).href;
      resolve(httpsDownload(next, dest, { maxRedirects: maxRedirects - 1 }));
      return;
    }
    if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
    const file = createWriteStream(dest);
    res.pipe(file);
    file.on("finish", () => file.close(() => resolve()));
    file.on("error", reject);
  });
  req.on("error", reject);
  req.setTimeout(120000, () => req.destroy(new Error(`Timeout downloading ${url}`)));
  return promise;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export function parseChecksum(checksumsText: string, assetName: string): string | null {
  const target = path.basename(assetName);
  for (const line of checksumsText.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && path.basename(m[2]) === target) return m[1].toLowerCase();
  }
  return null;
}

export async function readTextIfExists(p: string): Promise<string | null> {
  try { return await fs.readFile(p, "utf8"); } catch { return null; }
}

export function normalizeRtkVersion(value: string | undefined): string {
  return String(value || "").replace(/^rtk\s+/i, "").replace(/^v/i, "").trim();
}
