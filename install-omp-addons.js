#!/usr/bin/env node
// install-omp-addons.js — Install caveman/rtk/ponytail add-ons on any OMP device.
// Usage: node install-omp-addons.js [--dry-run]
// Requires: node, omp CLI, bun (for rtk binary)

import https from "node:https";
import { createHash, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import readline from "node:readline";

const IS_WINDOWS = process.platform === "win32";
const HOME = process.env.HOME || process.env.USERPROFILE || "";

const RL = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => RL.question(q, (a) => { RL.close(); res(a); }));

// Paths to extension source files (relative to this script)
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/[a-z]:/i, "");
const EXT_DIR = path.join(SCRIPT_DIR, "extensions");
const CAVEAN_INDEX = path.join(EXT_DIR, "caveman-session", "index.js");
const RTK_SESSION_INDEX = path.join(EXT_DIR, "rtk-session", "index.js");
const UPDATER_INDEX = path.join(EXT_DIR, "ai-addons-updater", "index.js");
const CAVERAN_REMOTE_RULE = "https://raw.githubusercontent.com/JuliusBrssee/caveman/main/src/rules/caveman-activate.md";
const RTK_RELEASE_API = "https://api.github.com/repos/rtk-ai/rtk/releases/latest";

// --- Helpers ---

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function readIfExists(p) {
  try { return await fs.readFile(p, "utf8"); } catch { return null; }
}

async function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "omp-supreme-token-saver" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpsGet(new URL(res.headers.location, url).href).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
  });
}

async function httpsDownload(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "omp-supreme-token-saver" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsDownload(new URL(res.headers.location, url).href, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });
    req.on("error", reject);
  });
}

function execP(cmd, args, opts = {}) {
  return execFile(cmd, args, { timeout: opts.timeout || 120000, encoding: "utf8", ...opts });
}

async function writeIfChanged(dest, content) {
  const existing = await readIfExists(dest);
  if (existing === content) {
    console.log(`  [skip] ${path.basename(dest)} (already present)`);
    return false;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (existing !== null) {
    await fs.copyFile(dest, `${dest}.bak`);
    console.log(`  [bak] ${path.basename(dest)} → ${path.basename(dest)}.bak`);
  }
  await fs.writeFile(dest, content, "utf8");
  console.log(`  [write] ${path.basename(dest)} (${content.length}b)`);
  return true;
}

// --- Steps ---

async function stepPonytail(pluginsDir) {
  console.log("\n[1/4] Installing Ponytail plugin...");
  const pkgPath = path.join(pluginsDir, "package.json");
  let pkg = {};
  const existing = await readIfExists(pkgPath);
  if (existing) pkg = JSON.parse(existing);

  pkg["omp-plugins"] = pkg["omp-plugins"] || { dependencies: {} };
  pkg["omp-plugins"].dependencies["@dietrichgebert/ponytail"] = "github:DietrichGebert/ponytail";
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  [write] package.json`);

  try {
    await execP(IS_WINDOWS ? "omp.cmd" : "omp", ["plugin", "install", "github:DietrichGebert/ponytail"],
      { cwd: pluginsDir });
    console.log("  [ok] Ponytail installed");
  } catch (e) {
    console.log(`  [fail] Ponytail: ${e.message}`);
    console.log(`  [hint] Manual: cd ~/.omp/plugins && omp plugin install github:DietrichGebert/ponytail`);
  }
}

async function stepRtk(binDir) {
  console.log("\n[2/4] Installing RTK binary...");
  try {
    const raw = await httpsGet(RTK_RELEASE_API);
    const release = JSON.parse(raw);
    const tag = release.tag_name;
    const zipAsset = (release.assets || []).find((a) =>
      a.name.includes("msvc") && a.name.endsWith(".zip")
    );

    if (!zipAsset) {
      console.log(`  [fail] No MSVC zip found in release ${tag}`);
      console.log(`  [hint] Manual: https://github.com/rtk-ai/rtk/releases`);
      return;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-rtk-"));
    const zipPath = path.join(tmpDir, zipAsset.name);

    await httpsDownload(zipAsset.browser_download_url, zipPath);

    // Extract
    const extractDir = path.join(tmpDir, "extracted");
    await fs.mkdir(extractDir, { recursive: true });

    if (IS_WINDOWS) {
      await execP("powershell", ["Expand-Archive", "-Path", zipPath, "-DestinationPath", extractDir, "-Force"],
        { timeout: 60000 });
    } else {
      await execP("unzip", [zipPath, "-d", extractDir], { timeout: 60000 });
    }

    // Find binary
    const binaryName = IS_WINDOWS ? "rtk.exe" : "rtk";
    const entries = await fs.readdir(extractDir, { recursive: true });
    const found = entries.find((e) => path.basename(e) === binaryName);
    if (!found) {
      console.log(`  [fail] Could not find ${binaryName} in extracted archive`);
      await fs.rm(tmpDir, { recursive: true, force: true });
      return;
    }

    const binDest = path.join(binDir, IS_WINDOWS ? "rtk.exe" : "rtk");
    await fs.mkdir(path.dirname(binDest), { recursive: true });
    await fs.copyFile(path.join(extractDir, found), binDest);
    console.log(`  [write] ${binDest}`);

    // Verify
    try {
      const v = (await execP(binDest, ["--version"], { timeout: 10000, shell: false })).stdout.trim();
      console.log(`  [ok] ${binDest} → ${v}`);
    } catch {
      console.log(`  [hint] Verify manually: ${binDest} --version`);
    }

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (e) {
    console.log(`  [fail] RTK: ${e.message}`);
    console.log(`  [hint] Manual: https://github.com/rtk-ai/rtk/releases`);
  }
}

async function stepRtkSession(extDir) {
  console.log("\n[3/4] Installing RTK session extension...");
  const src = await readIfExists(RTK_SESSION_INDEX);
  if (!src) {
    console.log("  [skip] rtk-session/index.js not found in repo");
    return;
  }
  const dest = path.join(extDir, "rtk-session", "index.js");
  await writeIfChanged(dest, src);
}

async function stepCaveman(extDir) {
  console.log("\n[4/4] Installing Caveman session extension...");
  const caVeranDir = path.join(extDir, "caveman-session");
  await fs.mkdir(caVeranDir, { recursive: true });

  // Fetch upstream rule
  const rule = await httpsGet(CAVERAN_REMOTE_RULE);
  await writeIfChanged(path.join(caVeranDir, "rule.md"), rule);

  // Write index.js
  const src = await readIfExists(CAVERAN_INDEX);
  if (!src) {
    console.log("  [skip] caveman-session/index.js not found in repo");
    return;
  }
  await writeIfChanged(path.join(caVeranDir, "index.js"), src);

  // Write updater
  const updaterSrc = await readIfExists(UPDATER_INDEX);
  if (updaterSrc) {
    const updaterDest = path.join(extDir, "ai-addons-updater", "index.js");
    await writeIfChanged(updaterDest, updaterSrc);
  } else {
    console.log("  [skip] ai-addons-updater/index.js not found in repo");
  }
}

// --- Main ---

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[dry-run] No changes will be written.\n");

  console.log("=== OMP Supreme Token Saver ===");
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Home: ${HOME}`);

  // Determine install scope
  console.log("\nInstall scope:");
  console.log("  1) User-level (all OMP sessions)");
  console.log("  2) Project-level (this repo only)");
  console.log("  3) Both");
  const scope = (await ask("\nChoose [1-3] (default 1): ")).trim() || "1";

  const userDir = path.join(HOME, ".omp", "agent");
  const userExtDir = path.join(userDir, "extensions");
  const userPluginsDir = path.join(userDir, "..", "plugins");
  const bunBinDir = path.join(HOME, ".bun", "bin");
  const projectExtDir = path.join(process.cwd(), ".omp", "extensions");

  // Check prerequisites
  console.log("\nPrerequisites:");
  try {
    const v = (await execP(IS_WINDOWS ? "omp.cmd" : "omp", ["--version"])).stdout.trim();
    console.log(`  [ok] omp ${v}`);
  } catch {
    console.log("  [fail] omp not found — ensure it's installed");
  }

  if (dryRun) {
    console.log("\n[Dry run complete. No files written.]");
    return;
  }

  // Install per scope
  if (scope === "1" || scope === "3") {
    console.log("\n--- User-level install ---");
    await stepPonytail(userPluginsDir);
    await stepRtk(bunBinDir);
    await stepRtkSession(userExtDir);
    await stepCaveman(userExtDir);
  }

  if (scope === "2" || scope === "3") {
    console.log("\n--- Project-level install ---");
    await stepRtkSession(projectExtDir);
    await stepCaveman(projectExtDir);
    console.log("  [note] Ponytail and RTK binary require user-level (global) install");
  }

  console.log("\n=== Installation complete ===");
  console.log("\nNext steps:");
  console.log("  1. Restart OMP");
  console.log("  2. /caveman full");
  console.log("  3. /rtk on");
  console.log("  4. /ponytail full");
  console.log("  5. /ai-addons check");
}

main().catch(console.error);
