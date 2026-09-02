#!/usr/bin/env node
// install-omp-addons.js — Install caveman/rtk/ponytail add-ons on any OMP device.
// Usage: node install-omp-addons.js [--dry-run] [--scope user|project|both] [--yes] [--verbose] [--doctor] [--uninstall]
// Requires: node, omp CLI, bun (for rtk binary)

import https from "node:https";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import readline from "node:readline";

const IS_WINDOWS = process.platform === "win32";
const HOME = process.env.HOME || process.env.USERPROFILE || "";

// --- CLI flags ---

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes") || args.includes("-y");
const verbose = args.includes("--verbose");
const doctor = args.includes("--doctor");
const uninstall = args.includes("--uninstall");
const removePonytail = args.includes("--remove-ponytail");
const removeRtk = args.includes("--remove-rtk");

const scopeFlag = (() => {
  const i = args.indexOf("--scope");
  if (i === -1) return null;
  return args[i + 1]?.toLowerCase() || null;
})();

function debug(...a) {
  if (verbose) console.log("  [debug]", ...a);
}

const RL = readline.createInterface({ input: process.stdin, output: process.stdout });
let rlOpen = true;
function ask(q) {
  return new Promise((res) => RL.question(q, (a) => { RL.close(); rlOpen = false; res(a); }));
}
function closeRL() { if (rlOpen) { RL.close(); rlOpen = false; } }

// Paths to extension source files (relative to this script)
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.join(SCRIPT_DIR, "extensions");
const CAVEMAN_INDEX = path.join(EXT_DIR, "caveman-session", "index.js");
const RTK_SESSION_INDEX = path.join(EXT_DIR, "rtk-session", "index.js");
const UPDATER_INDEX = path.join(EXT_DIR, "ai-addons-updater", "index.js");
const COMBO_TOGGLE_INDEX = path.join(EXT_DIR, "combo-toggle", "index.js");
const CAVEMAN_REMOTE_RULE = "https://raw.githubusercontent.com/JuliusBrussee/caveman/main/src/rules/caveman-activate.md";
const RTK_RELEASE_API = "https://api.github.com/repos/rtk-ai/rtk/releases/latest";

// --- Helpers ---

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function sha256File(filePath) {
  const buf = await fs.readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

async function readIfExists(p) {
  try { return await fs.readFile(p, "utf8"); } catch { return null; }
}

function parseChecksum(checksumsText, assetName) {
  for (const line of checksumsText.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && path.basename(match[2]) === assetName) {
      return match[1].toLowerCase();
    }
  }
  return null;
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

async function writeIfChanged(dest, content, options = {}) {
  const existing = await readIfExists(dest);
  if (existing === content) {
    debug(`${dest} already up to date`);
    return false;
  }
  if (options.dryRun) {
    console.log(`  [dry-run] would write ${dest}`);
    return true;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (existing !== null) {
    await fs.copyFile(dest, `${dest}.bak`);
    debug(`${path.basename(dest)} → ${path.basename(dest)}.bak`);
  }
  await fs.writeFile(dest, content, "utf8");
  console.log(`  [write] ${dest}`);
  return true;
}

async function ensureExtensionInConfig(configPath, extensionPath, label, options = {}) {
  const normalizedPath = extensionPath.replace(/\\/g, "/");
  const line = `  - ${normalizedPath}`;

  let raw = await readIfExists(configPath);
  let lines = (raw || "").split("\n");

  if (lines.some((l) => l.includes(normalizedPath))) {
    debug(`${label} already in config.yml`);
    return false;
  }

  const extLineIdx = lines.findIndex((l) => /^\s*extensions\s*:/i.test(l));

  if (options.dryRun) {
    console.log(`  [dry-run] would add ${label} to config.yml: ${normalizedPath}`);
    return true;
  }

  // Handle "extensions: []" (empty YAML array)
  const emptyArrayIdx = lines.findIndex((l) => /^\s*extensions\s*:\s*\[\s*\]\s*$/i.test(l));
  if (emptyArrayIdx !== -1) {
    lines[emptyArrayIdx] = "extensions:";
    lines.splice(emptyArrayIdx + 1, 0, line, "");
  } else if (extLineIdx === -1) {
    lines.push("extensions:");
    lines.push(line);
    lines.push("");
  } else {
    lines.splice(extLineIdx + 1, 0, line);
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, lines.join("\n"), "utf8");
  console.log(`  [write] Added ${label} to config.yml`);
  return true;
}

async function ensurePonytailDefaultOff(options = {}) {
  const configDir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "ponytail")
    : path.join(HOME, ".config", "ponytail");

  const configPath = path.join(configDir, "config.json");

  if (options.dryRun) {
    console.log(`  [dry-run] would set Ponytail defaultMode=off in ${configPath}`);
    return;
  }

  let config = {};
  const existing = await readIfExists(configPath);

  if (existing) {
    try {
      config = JSON.parse(existing.replace(/^\uFEFF/, ""));
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        config = {};
      }
    } catch {
      config = {};
    }
  }

  if (config.defaultMode === "off") {
    debug("Ponytail defaultMode already off");
    return;
  }

  await fs.mkdir(configDir, { recursive: true });
  config.defaultMode = "off";
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  console.log(`  [write] Set Ponytail defaultMode=off in ${configPath}`);
}

// --- Steps ---

async function stepPonytail(pluginsDir, userDir, options = {}) {
  console.log("\n[1/5] Installing Ponytail plugin...");
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, "package.json");
  let pkg = {};
  const existing = await readIfExists(pkgPath);
  if (existing) pkg = JSON.parse(existing);

  pkg.name = pkg.name || "omp-plugins";
  pkg.private = true;
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies["@dietrichgebert/ponytail"] = "github:DietrichGebert/ponytail";

  if (options.dryRun) {
    console.log(`  [dry-run] would write ${pkgPath}`);
  } else {
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  [write] package.json`);
  }

  if (options.dryRun) {
    console.log("  [dry-run] would run: omp plugin install github:DietrichGebert/ponytail");
    return;
  }

  // Try omp plugin install first
  try {
    await execP(IS_WINDOWS ? "omp.cmd" : "omp", ["plugin", "install", "github:DietrichGebert/ponytail"],
      { cwd: pluginsDir });
    console.log("  [ok] omp plugin install ran");
  } catch (e) {
    console.log(`  [warn] omp plugin install failed: ${e.message}`);
  }

  // Verify the pi-extension/index.js actually exists
  const ponytailExtPath = path.join(pluginsDir, "node_modules", "@dietrichgebert", "ponytail", "pi-extension", "index.js");
  let ponytailExtExists = await readIfExists(ponytailExtPath);

  // Fallback: try bun install or npm install
  if (!ponytailExtExists) {
    console.log("  [info] pi-extension/index.js not found after omp plugin install — trying npm/bun install...");
    try {
      await execP("npm", ["install"], { cwd: pluginsDir, timeout: 120000 });
      console.log("  [ok] npm install completed");
    } catch {
      try {
        await execP("bun", ["install"], { cwd: pluginsDir, timeout: 120000 });
        console.log("  [ok] bun install completed");
      } catch (e2) {
        console.log(`  [fail] Could not install ponytail: ${e2.message}`);
        console.log(`  [hint] Manual: cd ~/.omp/plugins && npm install`);
      }
    }
    ponytailExtExists = await readIfExists(ponytailExtPath);
  }

  // Last-resort fallback: git clone the repo into node_modules
  if (!ponytailExtExists) {
    console.log("  [info] npm/bun did not produce pi-extension — trying git clone...");
    try {
      const dest = path.join(pluginsDir, "node_modules", "@dietrichgebert", "ponytail");
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await execP("git", ["clone", "--depth", "1", "https://github.com/DietrichGebert/ponytail.git", dest],
        { timeout: 180000 });
      console.log("  [ok] git clone completed");
      ponytailExtExists = await readIfExists(ponytailExtPath);
    } catch (e3) {
      console.log(`  [fail] git clone failed: ${e3.message}`);
      console.log(`  [hint] Install git or check network: https://github.com/DietrichGebert/ponytail`);
    }
  }

  if (!ponytailExtExists) {
    console.log("  [skip] Ponytail pi-extension/index.js still not found — skill-only mode");
    console.log("  [hint] The /ponytail command won't work, but ponytail skills will still load");
    // Still set Ponytail config defaultMode=off even without the extension command
    await ensurePonytailDefaultOff(options);
    return;
  }

  // Wire extension into config.yml so /ponytail command loads
  console.log("  [ok] Ponytail pi-extension found");
  const configPath = path.join(userDir, "config.yml");
  await ensureExtensionInConfig(configPath, ponytailExtPath, "ponytail", options);
  await ensurePonytailDefaultOff(options);
}

async function stepRtk(binDir, options = {}) {
  console.log("\n[2/5] Installing RTK binary...");
  try {
    const raw = await httpsGet(RTK_RELEASE_API);
    const release = JSON.parse(raw);
    const tag = release.tag_name;

    // Map (platform, arch) → Rust triple stem.
    const PLATFORM = process.platform;
    const ARCH = process.arch;
    let assetTriple;
    if (PLATFORM === "win32" && ARCH === "x64") {
      assetTriple = "x86_64-pc-windows-msvc";
    } else if (PLATFORM === "linux" && ARCH === "x64") {
      assetTriple = "x86_64-unknown-linux-musl";
    } else if (PLATFORM === "linux" && ARCH === "arm64") {
      assetTriple = "aarch64-unknown-linux-gnu";
    } else if (PLATFORM === "darwin" && ARCH === "x64") {
      assetTriple = "x86_64-apple-darwin";
    } else if (PLATFORM === "darwin" && ARCH === "arm64") {
      assetTriple = "aarch64-apple-darwin";
    } else {
      console.log(`  [fail] Unsupported platform: ${PLATFORM}/${ARCH}`);
      console.log(`  [hint] Manual: https://github.com/rtk-ai/rtk/releases`);
      return;
    }

    const asset = (release.assets || []).find((a) =>
      a.name === `rtk-${assetTriple}.zip` || a.name === `rtk-${assetTriple}.tar.gz`
    );
    if (!asset) {
      console.log(`  [fail] No rtk-${assetTriple}.<zip|tar.gz> in release ${tag}`);
      console.log(`  [hint] Available: ${(release.assets || []).map((a) => a.name).filter((n) => n.startsWith("rtk-")).join(", ")}`);
      return;
    }

    const binDest = path.join(binDir, IS_WINDOWS ? "rtk.exe" : "rtk");

    if (options.dryRun) {
      console.log(`  [dry-run] would download ${asset.name} from release ${tag}`);
      console.log(`  [dry-run] would verify checksum against checksums.txt`);
      console.log(`  [dry-run] would extract and install to ${binDest}`);
      return;
    }

    // Also download checksums.txt for verification
    const checksumsAsset = (release.assets || []).find((a) => a.name === "checksums.txt");
    let checksumsText = null;
    if (checksumsAsset) {
      try {
        checksumsText = await httpsGet(checksumsAsset.browser_download_url);
      } catch (e) {
        debug(`Could not download checksums.txt: ${e.message}`);
      }
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-rtk-"));
    const archivePath = path.join(tmpDir, asset.name);

    await httpsDownload(asset.browser_download_url, archivePath);

    // Verify checksum
    if (checksumsText) {
      const expected = parseChecksum(checksumsText, asset.name);
      const actual = await sha256File(archivePath);
      if (!expected) {
        console.log(`  [warn] checksums.txt missing entry for ${asset.name} — skipping verification`);
      } else if (actual !== expected) {
        console.log(`  [fail] Checksum mismatch for ${asset.name}`);
        console.log(`  [fail] Expected: ${expected}`);
        console.log(`  [fail] Got:      ${actual}`);
        await fs.rm(tmpDir, { recursive: true, force: true });
        return;
      } else {
        console.log(`  [ok] Checksum verified for ${asset.name}`);
      }
    } else {
      console.log(`  [warn] No checksums.txt available — skipping verification`);
    }

    // Extract by extension (not OS)
    const extractDir = path.join(tmpDir, "extracted");
    await fs.mkdir(extractDir, { recursive: true });

    if (asset.name.endsWith(".zip")) {
      if (IS_WINDOWS) {
        await execP("powershell", ["Expand-Archive", "-Path", archivePath, "-DestinationPath", extractDir, "-Force"],
          { timeout: 60000 });
      } else {
        await execP("unzip", [archivePath, "-d", extractDir], { timeout: 60000 });
      }
    } else if (asset.name.endsWith(".tar.gz") || asset.name.endsWith(".tgz")) {
      try {
        await execP("tar", ["xzf", archivePath, "-C", extractDir], { timeout: 60000 });
        debug("tar xzf ok");
      } catch (e) {
        debug(`tar xzf failed: ${(e.stderr||e.message||"").trim().slice(0,200)}`);
        try {
          await execP("sh", ["-c", `gunzip < "${archivePath}" | tar xf - -C "${extractDir}"`], { timeout: 60000 });
          debug("gunzip|tar fallback ok");
        } catch (e2) {
          debug(`gunzip|tar fallback failed: ${(e2.stderr||e2.message||"").trim().slice(0,200)}`);
        }
      }
    } else {
      console.log(`  [fail] Unknown archive format: ${asset.name}`);
      await fs.rm(tmpDir, { recursive: true, force: true });
      return;
    }

    // Find binary
    const binaryName = IS_WINDOWS ? "rtk.exe" : "rtk";
    const entries = await fs.readdir(extractDir, { recursive: true });
    debug(`extracted entries: ${entries.join(", ")}`);
    const found = entries.find((e) => path.basename(e) === binaryName);
    if (!found) {
      console.log(`  [fail] Could not find ${binaryName} in extracted archive`);
      await fs.rm(tmpDir, { recursive: true, force: true });
      return;
    }

    await fs.mkdir(path.dirname(binDest), { recursive: true });
    await fs.copyFile(path.join(extractDir, found), binDest);
    console.log(`  [write] ${binDest}`);

    // Set executable bit on Unix
    if (!IS_WINDOWS) {
      await fs.chmod(binDest, 0o755);
      debug(`chmod 755 ${binDest}`);
    }

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

async function stepRtkSession(extDir, options = {}) {
  console.log("\n[3/5] Installing RTK session extension...");
  const src = await readIfExists(RTK_SESSION_INDEX);
  if (!src) {
    console.log("  [skip] rtk-session/index.js not found in repo");
    return;
  }
  const dest = path.join(extDir, "rtk-session", "index.js");
  await writeIfChanged(dest, src, options);
}

async function stepCaveman(extDir, options = {}) {
  console.log("\n[4/5] Installing Caveman session extension...");
  const cavemanDir = path.join(extDir, "caveman-session");
  if (!options.dryRun) await fs.mkdir(cavemanDir, { recursive: true });

  // Fetch upstream rule
  const rule = await httpsGet(CAVEMAN_REMOTE_RULE);
  await writeIfChanged(path.join(cavemanDir, "rule.md"), rule, options);

  // Write index.js
  const src = await readIfExists(CAVEMAN_INDEX);
  if (!src) {
    console.log("  [skip] caveman-session/index.js not found in repo");
    return;
  }
  await writeIfChanged(path.join(cavemanDir, "index.js"), src, options);

  // Write updater
  const updaterSrc = await readIfExists(UPDATER_INDEX);
  if (updaterSrc) {
    const updaterDest = path.join(extDir, "ai-addons-updater", "index.js");
    await writeIfChanged(updaterDest, updaterSrc, options);
  } else {
    console.log("  [skip] ai-addons-updater/index.js not found in repo");
  }
}

async function stepCombo(extDir, options = {}) {
  console.log("\n[5/5] Installing Combo toggle extension...");
  const src = await readIfExists(COMBO_TOGGLE_INDEX);
  if (!src) {
    console.log("  [skip] combo-toggle/index.js not found in repo");
    return;
  }
  const dest = path.join(extDir, "combo-toggle", "index.js");
  await writeIfChanged(dest, src, options);

  // Auto-register combo in config.yml
  const configPath = path.join(path.dirname(extDir), "config.yml");
  await ensureExtensionInConfig(configPath, dest, "combo", options);
}

// --- Doctor ---

async function runDoctor() {
  console.log("\n=== OMP Supreme Token Saver Doctor ===\n");

  // Node
  console.log(`  Node: ok v${process.version}`);

  // OMP CLI
  try {
    const v = (await execP(IS_WINDOWS ? "omp.cmd" : "omp", ["--version"])).stdout.trim();
    console.log(`  OMP CLI: ok ${v}`);
  } catch {
    console.log("  OMP CLI: MISSING");
  }

  // Home
  console.log(`  Home: ${HOME}`);

  // Directories
  const agentDir = path.join(HOME, ".omp", "agent");
  const extDir = path.join(agentDir, "extensions");
  const configPath = path.join(agentDir, "config.yml");
  const pluginsDir = path.join(HOME, ".omp", "plugins");
  const rtkBin = path.join(HOME, ".bun", "bin", IS_WINDOWS ? "rtk.exe" : "rtk");

  const agentOk = await readIfExists(agentDir) !== null || (await fs.readdir(agentDir).catch(() => null)) !== null;
  console.log(`  OMP agent dir: ${agentOk ? "ok" : "MISSING"} ${agentDir}`);

  const extOk = (await fs.readdir(extDir).catch(() => null)) !== null;
  console.log(`  OMP extensions dir: ${extOk ? "ok" : "MISSING"} ${extDir}`);

  const configOk = (await readIfExists(configPath)) !== null;
  console.log(`  OMP config.yml: ${configOk ? "ok" : "MISSING"} ${configPath}`);

  // Ponytail
  const ponytailPkg = path.join(pluginsDir, "node_modules", "@dietrichgebert", "ponytail", "package.json");
  const ponytailExt = path.join(pluginsDir, "node_modules", "@dietrichgebert", "ponytail", "pi-extension", "index.js");
  const ponytailInstalled = (await readIfExists(ponytailPkg)) !== null;
  const ponytailExtInstalled = (await readIfExists(ponytailExt)) !== null;
  console.log(`  Ponytail package: ${ponytailInstalled ? "installed" : "MISSING"}`);
  console.log(`  Ponytail extension: ${ponytailExtInstalled ? "installed" : "MISSING"}`);

  if (configOk) {
    const configText = await readIfExists(configPath);
    const hasPonytailPath = configText.includes("ponytail") && configText.includes("pi-extension");
    console.log(`  Ponytail in config.yml: ${hasPonytailPath ? "registered" : "MISSING"}`);
  }

  // RTK
  const rtkExists = (await readIfExists(rtkBin)) !== null;
  console.log(`  RTK binary: ${rtkExists ? "installed" : "MISSING"} ${rtkBin}`);
  if (rtkExists) {
    try {
      const v = (await execP(rtkBin, ["--version"], { timeout: 5000 })).stdout.trim();
      console.log(`  RTK version: ${v}`);
    } catch {
      console.log("  RTK version: unavailable (may not be executable)");
    }
  }

  // Caveman
  const cavemanIndex = path.join(extDir, "caveman-session", "index.js");
  const cavemanRule = path.join(extDir, "caveman-session", "rule.md");
  console.log(`  Caveman extension: ${(await readIfExists(cavemanIndex)) !== null ? "installed" : "MISSING"}`);
  console.log(`  Caveman rule.md: ${(await readIfExists(cavemanRule)) !== null ? "installed" : "MISSING"}`);

  // RTK extension
  const rtkIndex = path.join(extDir, "rtk-session", "index.js");
  console.log(`  RTK extension: ${(await readIfExists(rtkIndex)) !== null ? "installed" : "MISSING"}`);

  // Updater
  const updaterIndex = path.join(extDir, "ai-addons-updater", "index.js");
  console.log(`  Updater extension: ${(await readIfExists(updaterIndex)) !== null ? "installed" : "MISSING"}`);

  // Combo
  const comboIndex = path.join(extDir, "combo-toggle", "index.js");
  console.log(`  Combo extension: ${(await readIfExists(comboIndex)) !== null ? "installed" : "MISSING"}`);

  if (configOk) {
    const configText = await readIfExists(configPath);
    const hasComboPath = configText.includes("combo-toggle");
    console.log(`  Combo in config.yml: ${hasComboPath ? "registered" : "MISSING"}`);
  }
}

// --- Uninstall ---

async function runUninstall() {
  console.log("\n=== OMP Supreme Token Saver Uninstall ===\n");

  const extDir = path.join(HOME, ".omp", "agent", "extensions");
  const configPath = path.join(HOME, ".omp", "agent", "config.yml");
  const rtkBin = path.join(HOME, ".bun", "bin", IS_WINDOWS ? "rtk.exe" : "rtk");

  const targets = [
    path.join(extDir, "caveman-session"),
    path.join(extDir, "rtk-session"),
    path.join(extDir, "ai-addons-updater"),
    path.join(extDir, "combo-toggle"),
  ];

  console.log("Will remove:");
  for (const t of targets) {
    console.log(`  ${t}`);
  }

  if (removeRtk) {
    console.log(`  ${rtkBin}`);
  }

  if (!yes) {
    const answer = await ask("\nProceed? [y/N]: ");
    if (!answer.toLowerCase().startsWith("y")) {
      console.log("Aborted.");
      closeRL();
      return;
    }
  }

  // Remove extension directories
  for (const t of targets) {
    try {
      await fs.rm(t, { recursive: true, force: true });
      console.log(`  [rm] ${t}`);
    } catch {
      debug(`Could not remove ${t}`);
    }
  }

  // Remove combo and ponytail from config.yml
  const configRaw = await readIfExists(configPath);
  if (configRaw) {
    let lines = configRaw.split("\n");
    const before = lines.length;
    lines = lines.filter((l) => {
      if (l.includes("combo-toggle")) return false;
      if (removePonytail && l.includes("ponytail") && l.includes("pi-extension")) return false;
      return true;
    });
    if (lines.length !== before) {
      await fs.writeFile(configPath, lines.join("\n"), "utf8");
      console.log(`  [write] Updated config.yml (removed ${before - lines.length} entries)`);
    }
  }

  // Remove RTK binary if requested
  if (removeRtk) {
    try {
      await fs.unlink(rtkBin);
      console.log(`  [rm] ${rtkBin}`);
    } catch {
      debug(`Could not remove ${rtkBin}`);
    }
  }

  console.log("\nDone. Restart OMP for changes to take effect.");
}

// --- Main ---

async function main() {
  if (doctor) {
    await runDoctor();
    closeRL();
    return;
  }

  if (uninstall) {
    await runUninstall();
    closeRL();
    return;
  }

  if (dryRun) console.log("[dry-run] No changes will be written.\n");

  console.log("=== OMP Supreme Token Saver ===");
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Arch: ${process.arch}`);
  console.log(`  Home: ${HOME}`);

  // Determine install scope
  let scope;
  if (scopeFlag) {
    const map = { user: "1", project: "2", both: "3" };
    scope = map[scopeFlag];
    if (!scope) {
      console.log(`  [fail] Invalid --scope: ${scopeFlag}. Use: user, project, both`);
      closeRL();
      process.exit(1);
    }
    console.log(`  Scope: ${scopeFlag}`);
  } else if (yes) {
    scope = "1";
    console.log("  Scope: user (--scope omitted, defaulting to user with --yes)");
  } else {
    console.log("\nInstall scope:");
    console.log("  1) User-level (all OMP sessions)");
    console.log("  2) Project-level (this repo only)");
    console.log("  3) Both");
    scope = (await ask("\nChoose [1-3] (default 1): ")).trim() || "1";
  }

  const userDir = path.join(HOME, ".omp", "agent");
  const userExtDir = path.join(userDir, "extensions");
  const userPluginsDir = path.join(userDir, "..", "plugins");
  const bunBinDir = path.join(HOME, ".bun", "bin");
  const projectExtDir = path.join(process.cwd(), ".omp", "extensions");

  const options = { dryRun, verbose, yes, scope };

  // Check prerequisites
  console.log("\nPrerequisites:");
  try {
    const v = (await execP(IS_WINDOWS ? "omp.cmd" : "omp", ["--version"])).stdout.trim();
    console.log(`  [ok] omp ${v}`);
  } catch {
    console.log("  [fail] omp not found — ensure it's installed");
  }

  // Install per scope
  if (scope === "1" || scope === "3") {
    console.log("\n--- User-level install ---");
    await stepPonytail(userPluginsDir, userDir, options);
    await stepRtk(bunBinDir, options);
    await stepRtkSession(userExtDir, options);
    await stepCaveman(userExtDir, options);
    await stepCombo(userExtDir, options);
  }

  if (scope === "2" || scope === "3") {
    console.log("\n--- Project-level install ---");
    await stepRtkSession(projectExtDir, options);
    await stepCaveman(projectExtDir, options);
    console.log("  [note] Ponytail, RTK binary, and Combo toggle require user-level (global) install");
  }

  console.log("\n=== Installation complete ===");
  console.log("\nNext steps:");
  console.log("  1. Restart OMP");
  console.log("  2. /caveman full");
  console.log("  3. /rtk on");
  console.log("  4. /ponytail full");
  console.log("  5. /ai-addons check");
  console.log("  6. /combo medium   (toggle all 3 at once — off by default)");

  closeRL();
}

main().catch((e) => { closeRL(); console.error(e); });
