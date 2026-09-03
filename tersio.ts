#!/usr/bin/env node
// tersio.ts — Install Tersio (caveman/rtk/ponytail) add-ons on any OMP device.
// Usage: node tersio.js [install|update|reinstall|doctor|uninstall|version|help] [options]
// Requires: node/npm and omp CLI

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createRequire } from "node:module";

import {
  httpsGet,
  httpsDownload,
  sha256Hex,
  sha256File,
  parseChecksum,
  readTextIfExists,
} from "./extensions/lib/utils.ts";

const IS_WINDOWS = process.platform === "win32";
const HOME = process.env.HOME || process.env.USERPROFILE || "";

const PACKAGE_NAME = "@krtclcdy/tersio";
const PACKAGE_BIN = "tersio";
const { version: PACKAGE_VERSION } = createRequire(import.meta.url)("./package.json") as { version: string };

// --- Types ---

interface InstallOptions {
  dryRun: boolean;
  verbose: boolean;
  yes: boolean;
  scope: string;
  reinstall: boolean;
}

// Session-start mode defaults for fresh installs.
const COMBO_DEFAULTS: Record<string, true> = { off: true, medium: true, balanced: true, max: true };
const CAVEMAN_DEFAULTS: Record<string, true> = { off: true, lite: true, full: true, ultra: true, wenyan: true };

interface Profile {
  comboDefault: string;
  cavemanDefault: string;
  rtkDefault: boolean;
}

function parseEnum(value: string | undefined, valid: Record<string, true>, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (!(v in valid)) {
    console.error(`[fail] Invalid ${flag}: ${value}. Valid: ${Object.keys(valid).join(", ")}`);
    process.exit(1);
  }
  return v;
}

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

// --- CLI flags ---

const COMMANDS: Record<string, true> = { install: true, update: true, reinstall: true, doctor: true, uninstall: true, version: true, help: true };
const args = process.argv.slice(2);
const commandArg = args.find((arg, index) => !arg.startsWith("-") && args[index - 1] !== "--scope");
const command = commandArg?.toLowerCase() || null;
const unknownCommand = command !== null && !(command in COMMANDS);
const install = command === "install";
const update = command === "update";
const reinstall = command === "reinstall";
const showVersion = command === "version" || args.includes("--version") || args.includes("-v");
const showHelp = command === "help" || args.includes("--help") || args.includes("-h");
const applyUpdate = args.includes("--apply-update");
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes") || args.includes("-y") || install || update || reinstall || applyUpdate;
const verbose = args.includes("--verbose");
const doctor = command === "doctor" || args.includes("--doctor");
const uninstall = command === "uninstall" || args.includes("--uninstall");
const removePonytail = args.includes("--remove-ponytail");
const removeRtk = args.includes("--remove-rtk");

const scopeFlag = (() => {
  const i = args.indexOf("--scope");
  if (i === -1) return null;
  return args[i + 1]?.toLowerCase() || null;
})();

// --- Profile selection (session-start mode defaults) ---

const comboDefaultFlag = parseEnum(flagValue("--combo-default"), COMBO_DEFAULTS, "--combo-default");
const cavemanDefaultFlag = parseEnum(flagValue("--caveman-default"), CAVEMAN_DEFAULTS, "--caveman-default");
const rtkDefaultFlag = flagValue("--rtk-default")?.toLowerCase();

if (rtkDefaultFlag !== undefined && rtkDefaultFlag !== "on" && rtkDefaultFlag !== "off") {
  console.error(`[fail] Invalid --rtk-default: ${rtkDefaultFlag}. Use: on, off`);
  process.exit(1);
}

const profileFlagsGiven = comboDefaultFlag !== undefined
  || cavemanDefaultFlag !== undefined || rtkDefaultFlag !== undefined;

function printHelp(): void {
  console.log(`Usage: ${PACKAGE_BIN} [command] [options]

Commands:
  install      Install the add-ons (user scope by default)
  update       Run the latest published installer
  reinstall    Clean and reinstall the user-scope add-ons
  doctor       Check the current installation
  uninstall    Remove the managed extensions
  version      Print the package version
  help         Show this help

Options:
  --scope user|project|both
  --combo-default off|medium|balanced|max
  --caveman-default off|lite|full|ultra|wenyan
  --rtk-default on|off
  --yes, -y
  --dry-run
  --verbose
  --version, -v
  --help, -h`);
}

function debug(...a: unknown[]): void {
  if (verbose) console.log("  [debug]", ...a);
}

const RL = readline.createInterface({ input: process.stdin, output: process.stdout });
let rlOpen = true;
function ask(q: string): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  RL.question(q, resolve);
  return promise;
}
function closeRL(): void { if (rlOpen) { RL.close(); rlOpen = false; } }

// Paths to extension source files (relative to this script)
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.join(SCRIPT_DIR, "extensions");
const SHARED_SESSION_STATE = path.join(EXT_DIR, "shared", "session-state.js");
const CAVEMAN_INDEX = path.join(EXT_DIR, "caveman-session", "index.js");
const RTK_SESSION_INDEX = path.join(EXT_DIR, "rtk-session", "index.js");
const UPDATER_INDEX = path.join(EXT_DIR, "ai-addons-updater", "index.js");
const COMBO_TOGGLE_INDEX = path.join(EXT_DIR, "combo-toggle", "index.js");
const AMANAI_REWARD_INDEX = path.join(EXT_DIR, "amanai-reward", "index.js");
const MODE_REINFORCEMENT_INDEX = path.join(EXT_DIR, "shared", "mode-reinforcement.js");
const SHARED_TYPES = path.join(EXT_DIR, "shared", "types.js");
const LIB_UTILS = path.join(EXT_DIR, "lib", "utils.js");
const SHARED_PLUGIN_SETTINGS = path.join(EXT_DIR, "shared", "plugin-settings.js");
const CAVEMAN_REMOTE_RULE = "https://raw.githubusercontent.com/JuliusBrussee/caveman/main/src/rules/caveman-activate.md";
const RTK_RELEASE_API = "https://api.github.com/repos/rtk-ai/rtk/releases/latest";

// --- Helpers ---

const execFileP = promisify(execFile);

interface ExecOptions {
  timeout?: number;
  cwd?: string;
  encoding?: BufferEncoding;
  maxBuffer?: number;
  windowsHide?: boolean;
  shell?: boolean | string;
  env?: NodeJS.ProcessEnv;
}

async function execP(cmd: string, args: string[], opts: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, {
    timeout: opts.timeout || 120000,
    encoding: "utf8",
    ...opts,
  }) as Promise<{ stdout: string; stderr: string }>;
}

interface WriteOptions {
  dryRun?: boolean;
}

async function writeIfChanged(dest: string, content: string, options: WriteOptions = {}): Promise<boolean> {
  const existing = await readTextIfExists(dest);
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

async function ensureExtensionInConfig(configPath: string, extensionPath: string, label: string, options: WriteOptions = {}): Promise<boolean> {
  const normalizedPath = extensionPath.replace(/\\/g, "/");
  const line = `  - ${normalizedPath}`;

  const raw = await readTextIfExists(configPath);
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

async function ensureExtensionAfterConfigEntry(configPath: string, extensionPath: string, afterPath: string, label: string, options: WriteOptions = {}): Promise<boolean> {
  const normalizedPath = extensionPath.replace(/\\/g, "/");
  const normalizedAfterPath = afterPath.replace(/\\/g, "/");
  const line = `  - ${normalizedPath}`;
  const raw = await readTextIfExists(configPath);
  const lines = (raw || "").split("\n");
  const existingIndex = lines.findIndex((entry) => entry.includes(normalizedPath));
  const afterIndex = lines.findIndex((entry) => entry.includes(normalizedAfterPath));

  if (existingIndex !== -1 && afterIndex !== -1 && existingIndex === afterIndex + 1) return false;
  if (options.dryRun) {
    console.log(`  [dry-run] would place ${label} after Ponytail in config.yml: ${normalizedPath}`);
    return true;
  }

  if (existingIndex !== -1) lines.splice(existingIndex, 1);
  const refreshedAfterIndex = lines.findIndex((entry) => entry.includes(normalizedAfterPath));
  if (refreshedAfterIndex !== -1) {
    lines.splice(refreshedAfterIndex + 1, 0, line);
  } else {
    const extensionsIndex = lines.findIndex((entry) => /^\s*extensions\s*:/i.test(entry));
    if (extensionsIndex === -1) {
      lines.push("extensions:", line, "");
    } else {
      lines.splice(extensionsIndex + 1, 0, line);
    }
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, lines.join("\n"), "utf8");
  console.log(`  [write] Placed ${label} after Ponytail in config.yml`);
  return true;
}

function readPonytailConfig(): { dir: string; path: string } {
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "ponytail")
    : path.join(HOME, ".config", "ponytail");
  return { dir, path: path.join(dir, "config.json") };
}

interface PonytailConfig {
  defaultMode?: string;
  hideStatus?: boolean;
  [key: string]: unknown;
}

async function ensurePonytailDefaultOff(options: WriteOptions = {}): Promise<void> {
  const config = readPonytailConfig();

  if (options.dryRun) {
    console.log(`  [dry-run] would set Ponytail defaultMode=off in ${config.path}`);
    return;
  }

  let cfg: PonytailConfig = {};
  const existing = await readTextIfExists(config.path);

  if (existing) {
    try {
      cfg = JSON.parse(existing.replace(/^\uFEFF/, ""));
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
        cfg = {};
      }
    } catch {
      cfg = {};
    }
  }

  if (cfg.defaultMode === "off") {
    debug("Ponytail defaultMode already off");
    return;
  }

  await fs.mkdir(config.dir, { recursive: true });
  cfg.defaultMode = "off";
  await fs.writeFile(config.path, JSON.stringify(cfg, null, 2) + "\n", "utf8");

  console.log(`  [write] Set Ponytail defaultMode=off in ${config.path}`);
}

// Sets ~/.config/ponytail/config.json#hideStatus=true so the upstream ponytail
// status bar doesn't render — the combo extension owns the bar instead.
async function ensurePonytailHideStatus(options: WriteOptions = {}): Promise<void> {
  const config = readPonytailConfig();
  if (options.dryRun) {
    console.log(`  [dry-run] would set Ponytail hideStatus=true in ${config.path}`);
    return;
  }
  let cfg: PonytailConfig = {};
  const existing = await readTextIfExists(config.path);
  if (existing) {
    try {
      cfg = JSON.parse(existing.replace(/^\uFEFF/, ""));
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) cfg = {};
    } catch { cfg = {}; }
  }
  if (cfg.hideStatus === true) {
    debug("Ponytail hideStatus already true");
    return;
  }
  await fs.mkdir(config.dir, { recursive: true });
  cfg.hideStatus = true;
  await fs.writeFile(config.path, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  console.log(`  [write] Set Ponytail hideStatus=true in ${config.path}`);
}

// --- Steps ---

async function stepPonytail(pluginsDir: string, userDir: string, options: InstallOptions): Promise<void> {
  console.log("\n[1/8] Installing Ponytail plugin...");
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, "package.json");
  let pkg: Record<string, any> = {};
  const existing = await readTextIfExists(pkgPath);
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
    if (options.reinstall) {
      console.log("  [dry-run] would run: npm install @dietrichgebert/ponytail@latest --save --no-audit --no-fund");
    }

    const ponytailExtPath = path.join(
      pluginsDir,
      "node_modules",
      "@dietrichgebert",
      "ponytail",
      "pi-extension",
      "index.js"
    );

    const configPath = path.join(userDir, "config.yml");
    await ensureExtensionInConfig(configPath, ponytailExtPath, "ponytail", options);
    await ensurePonytailDefaultOff(options);
    await ensurePonytailHideStatus(options);
    return;
  }

  // Try omp plugin install first
  try {
    await execP(IS_WINDOWS ? "omp.cmd" : "omp", ["plugin", "install", "github:DietrichGebert/ponytail"],
      { cwd: pluginsDir });
    console.log("  [ok] omp plugin install ran");
  } catch (e) {
    console.log(`  [warn] omp plugin install failed: ${(e as Error).message}`);
  }

  if (options.reinstall) {
    try {
      await execP("npm", [
        "install",
        "@dietrichgebert/ponytail@latest",
        "--save",
        "--no-audit",
        "--no-fund",
      ], { cwd: pluginsDir, timeout: 120000 });
      console.log("  [ok] Ponytail refreshed");
    } catch (e) {
      console.log(`  [fail] Could not refresh ponytail: ${(e as Error).message}`);
      console.log(`  [hint] Manual: cd ~/.omp/plugins && npm install @dietrichgebert/ponytail@latest --save --no-audit --no-fund`);
    }
  }

  // Verify the pi-extension/index.js actually exists
  const ponytailExtPath = path.join(pluginsDir, "node_modules", "@dietrichgebert", "ponytail", "pi-extension", "index.js");
  let ponytailExtExists = await readTextIfExists(ponytailExtPath);

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
        console.log(`  [fail] Could not install ponytail: ${(e2 as Error).message}`);
        console.log(`  [hint] Manual: cd ~/.omp/plugins && npm install`);
      }
    }
    ponytailExtExists = await readTextIfExists(ponytailExtPath);
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
      ponytailExtExists = await readTextIfExists(ponytailExtPath);
    } catch (e3) {
      console.log(`  [fail] git clone failed: ${(e3 as Error).message}`);
      console.log(`  [hint] Install git or check network: https://github.com/DietrichGebert/ponytail`);
    }
  }

  if (!ponytailExtExists) {
    console.log("  [skip] Ponytail pi-extension/index.js still not found — skill-only mode");
    console.log("  [hint] The /ponytail command won't work, but ponytail skills will still load");
    // Still set Ponytail config defaultMode=off even without the extension command
    await ensurePonytailDefaultOff(options);
    await ensurePonytailHideStatus(options);
    return;
  }

  // Wire extension into config.yml so /ponytail command loads
  console.log("  [ok] Ponytail pi-extension found");
  const configPath = path.join(userDir, "config.yml");
  await ensureExtensionInConfig(configPath, ponytailExtPath, "ponytail", options);
  await ensurePonytailDefaultOff(options);
  await ensurePonytailHideStatus(options);
}

// Registers this package in ~/.omp/plugins so OMP lists it on the
// Settings → Plugins page (OMP enumerates plugins/package.json dependencies).
// Returns true when the package is verified in plugins/node_modules — the
// Amanai detector then loads via the plugin's `omp.extensions` manifest, so
// the caller must skip copying it into agent/extensions to avoid a double load.
async function stepSelfPlugin(pluginsDir: string, options: InstallOptions): Promise<boolean> {
  console.log("\n[2/8] Registering tersio as OMP plugin...");
  const pkgPath = path.join(pluginsDir, "package.json");
  let pkg: Record<string, any> = {};
  const existing = await readTextIfExists(pkgPath);
  if (existing) {
    try { pkg = JSON.parse(existing); } catch { pkg = {}; }
  }
  pkg.name = pkg.name || "omp-plugins";
  pkg.private = true;
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies[PACKAGE_NAME] = `^${PACKAGE_VERSION}`;
  for (const legacy of ["oh-my-pi-token-saver", "tersio-omp"]) {
    if (legacy in pkg.dependencies) {
      delete pkg.dependencies[legacy];
      if (!options.dryRun) console.log(`  [migrate] dropped legacy ${legacy} dependency`);
    }
  }

  if (options.dryRun) {
    console.log(`  [dry-run] would add ${PACKAGE_NAME}@^${PACKAGE_VERSION} to ${pkgPath}`);
    console.log(`  [dry-run] would run: npm install --no-audit --no-fund (in ${pluginsDir})`);
    return false;
  }

  await fs.mkdir(pluginsDir, { recursive: true });
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  try {
    await execP("npm", ["install", "--no-audit", "--no-fund"], { cwd: pluginsDir, timeout: 180000 });
  } catch {
    try {
      await execP("bun", ["install"], { cwd: pluginsDir, timeout: 180000 });
    } catch (e) {
      console.log(`  [fail] Could not install ${PACKAGE_NAME} into plugins dir: ${(e as Error).message}`);
      console.log(`  [hint] Manual: cd ~/.omp/plugins && npm install ${PACKAGE_NAME}@^${PACKAGE_VERSION} --save --no-audit --no-fund`);
      return false;
    }
  }

  const installedPkg = path.join(pluginsDir, "node_modules", PACKAGE_NAME, "package.json");
  if ((await readTextIfExists(installedPkg)) === null) {
    console.log(`  [warn] ${PACKAGE_NAME} not found in plugins/node_modules after install`);
    return false;
  }
  console.log("  [ok] Listed in OMP Settings → Plugins as tersio");
  return true;
}

async function stepRtk(binDir: string, options: InstallOptions): Promise<void> {
  console.log("\n[3/8] Installing RTK binary...");
  try {
    const raw = await httpsGet(RTK_RELEASE_API);
    const release = JSON.parse(raw);
    const tag = release.tag_name;

    // Map (platform, arch) → Rust triple stem.
    const PLATFORM = process.platform;
    const ARCH = process.arch;
    let assetTriple: string;
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

    const asset = (release.assets || []).find((a: { name: string }) =>
      a.name === `rtk-${assetTriple}.zip` || a.name === `rtk-${assetTriple}.tar.gz`
    );
    if (!asset) {
      console.log(`  [fail] No rtk-${assetTriple}.<zip|tar.gz> in release ${tag}`);
      console.log(`  [hint] Available: ${(release.assets || []).map((a: { name: string }) => a.name).filter((n: string) => n.startsWith("rtk-")).join(", ")}`);
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
    const checksumsAsset = (release.assets || []).find((a: { name: string }) => a.name === "checksums.txt");
    let checksumsText: string | null = null;
    if (checksumsAsset) {
      try {
        checksumsText = await httpsGet(checksumsAsset.browser_download_url);
      } catch (e) {
        debug(`Could not download checksums.txt: ${(e as Error).message}`);
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
        debug(`tar xzf failed: ${(((e as Error & { stderr?: string }).stderr) || (e as Error).message || "").trim().slice(0, 200)}`);
        try {
          await execP("sh", ["-c", `gunzip < "${archivePath}" | tar xf - -C "${extractDir}"`], { timeout: 60000 });
          debug("gunzip|tar fallback ok");
        } catch (e2) {
          debug(`gunzip|tar fallback failed: ${(((e2 as Error & { stderr?: string }).stderr) || (e2 as Error).message || "").trim().slice(0, 200)}`);
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
    console.log(`  [fail] RTK: ${(e as Error).message}`);
    console.log(`  [hint] Manual: https://github.com/rtk-ai/rtk/releases`);
  }
}

async function stepSharedSessionState(extDir: string, options: WriteOptions): Promise<void> {
  const src = await readTextIfExists(SHARED_SESSION_STATE);
  if (!src) {
    console.log("  [skip] shared/session-state.js not found in repo");
    return;
  }
  await writeIfChanged(path.join(extDir, "shared", "session-state.js"), src, options);
  const typesSrc = await readTextIfExists(SHARED_TYPES);
  if (typesSrc) await writeIfChanged(path.join(extDir, "shared", "types.js"), typesSrc, options);
  const utilsSrc = await readTextIfExists(LIB_UTILS);
  if (utilsSrc) await writeIfChanged(path.join(extDir, "lib", "utils.js"), utilsSrc, options);
  const settingsSrc = await readTextIfExists(SHARED_PLUGIN_SETTINGS);
  if (settingsSrc) await writeIfChanged(path.join(extDir, "shared", "plugin-settings.js"), settingsSrc, options);
}

async function stepModeReinforcement(extDir: string, ponytailExtPath: string, options: WriteOptions): Promise<void> {
  console.log("\n[7/8] Installing mode reinforcement extension...");
  const src = await readTextIfExists(MODE_REINFORCEMENT_INDEX);
  if (!src) {
    console.log("  [skip] shared/mode-reinforcement.js not found in repo");
    return;
  }
  const dest = path.join(extDir, "shared", "mode-reinforcement.js");
  await writeIfChanged(dest, src, options);
  await ensureExtensionAfterConfigEntry(path.join(path.dirname(extDir), "config.yml"), dest, ponytailExtPath, "mode reinforcement", options);
}

async function stepRtkSession(extDir: string, options: WriteOptions): Promise<void> {
  console.log("\n[4/8] Installing RTK session extension...");
  const src = await readTextIfExists(RTK_SESSION_INDEX);
  if (!src) {
    console.log("  [skip] rtk-session/index.js not found in repo");
    return;
  }
  const dest = path.join(extDir, "rtk-session", "index.js");
  await writeIfChanged(dest, src, options);
}

async function stepCaveman(extDir: string, options: WriteOptions): Promise<void> {
  console.log("\n[5/8] Installing Caveman session extension...");
  const cavemanDir = path.join(extDir, "caveman-session");
  if (!options.dryRun) await fs.mkdir(cavemanDir, { recursive: true });

  // Dry runs stay offline; the bundled rule is enough to preview its destination.
  const rule = options.dryRun ? await readTextIfExists(path.join(path.dirname(CAVEMAN_INDEX), "rule.md")) || "" : await httpsGet(CAVEMAN_REMOTE_RULE);
  await writeIfChanged(path.join(cavemanDir, "rule.md"), rule, options);

  // Write index.js
  const src = await readTextIfExists(CAVEMAN_INDEX);
  if (!src) {
    console.log("  [skip] caveman-session/index.js not found in repo");
    return;
  }
  await writeIfChanged(path.join(cavemanDir, "index.js"), src, options);

}

async function stepUpdater(extDir: string, options: WriteOptions): Promise<void> {
  const updaterSrc = await readTextIfExists(UPDATER_INDEX);
  if (!updaterSrc) {
    console.log("  [skip] ai-addons-updater/index.js not found in repo");
    return;
  }
  await writeIfChanged(path.join(extDir, "ai-addons-updater", "index.js"), updaterSrc, options);
}

async function stepCombo(extDir: string, options: WriteOptions): Promise<void> {
  console.log("\n[6/8] Installing Combo toggle extension...");
  const src = await readTextIfExists(COMBO_TOGGLE_INDEX);
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

async function stepAmanaiReward(extDir: string, options: WriteOptions, pluginProvided = false): Promise<void> {
  console.log("\n[8/8] Installing Amanai reward detector...");
  const destDir = path.join(extDir, "amanai-reward");
  if (pluginProvided) {
    // The plugin's omp.extensions manifest loads the detector from
    // plugins/node_modules; a copied agent/extensions entry would double-load.
    if ((await readTextIfExists(path.join(destDir, "index.js"))) !== null) {
      if (options.dryRun) console.log(`  [dry-run] would remove ${destDir} (now provided by the plugin)`);
      else {
        await fs.rm(destDir, { recursive: true, force: true });
        console.log(`  [rm] ${destDir} (now provided by the plugin)`);
      }
    }
    console.log("  [ok] detector loads via the tersio plugin manifest");
    return;
  }
  const src = await readTextIfExists(AMANAI_REWARD_INDEX);
  if (!src) {
    console.log("  [skip] amanai-reward/index.js not found in repo");
    return;
  }
  await writeIfChanged(path.join(destDir, "index.js"), src, options);
}

// --- Doctor ---

async function runDoctor(): Promise<void> {
  console.log("\n=== Tersio Doctor ===\n");

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

  const agentOk = await readTextIfExists(agentDir) !== null || (await fs.readdir(agentDir).catch(() => null)) !== null;
  console.log(`  OMP agent dir: ${agentOk ? "ok" : "MISSING"} ${agentDir}`);

  const extOk = (await fs.readdir(extDir).catch(() => null)) !== null;
  console.log(`  OMP extensions dir: ${extOk ? "ok" : "MISSING"} ${extDir}`);

  const sharedState = path.join(extDir, "shared", "session-state.js");
  console.log(`  Shared session bridge: ${(await readTextIfExists(sharedState)) !== null ? "installed" : "MISSING"}`);

  const configOk = (await readTextIfExists(configPath)) !== null;
  console.log(`  OMP config.yml: ${configOk ? "ok" : "MISSING"} ${configPath}`);

  // Ponytail
  const ponytailPkg = path.join(pluginsDir, "node_modules", "@dietrichgebert", "ponytail", "package.json");
  const ponytailExt = path.join(pluginsDir, "node_modules", "@dietrichgebert", "ponytail", "pi-extension", "index.js");
  const ponytailInstalled = (await readTextIfExists(ponytailPkg)) !== null;
  const ponytailExtInstalled = (await readTextIfExists(ponytailExt)) !== null;
  console.log(`  Ponytail package: ${ponytailInstalled ? "installed" : "MISSING"}`);
  console.log(`  Ponytail extension: ${ponytailExtInstalled ? "installed" : "MISSING"}`);

  if (configOk) {
    const configText = (await readTextIfExists(configPath))!;
    const hasPonytailPath = configText.includes("ponytail") && configText.includes("pi-extension");
    console.log(`  Ponytail in config.yml: ${hasPonytailPath ? "registered" : "MISSING"}`);
  }

  // Self plugin registration (Settings → Plugins listing)
  const pluginsPkgRaw = await readTextIfExists(path.join(pluginsDir, "package.json"));
  let selfDep = false;
  if (pluginsPkgRaw) {
    try { selfDep = PACKAGE_NAME in ((JSON.parse(pluginsPkgRaw) as { dependencies?: Record<string, string> }).dependencies || {}); } catch { /* ignore */ }
  }
  console.log(`  Self plugin in plugins/package.json: ${selfDep ? "registered" : "MISSING"}`);
  const selfPkg = path.join(pluginsDir, "node_modules", PACKAGE_NAME, "package.json");
  console.log(`  Self plugin package: ${(await readTextIfExists(selfPkg)) !== null ? "installed" : "MISSING"}`);

  // RTK
  const rtkExists = (await readTextIfExists(rtkBin)) !== null;
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
  console.log(`  Caveman extension: ${(await readTextIfExists(cavemanIndex)) !== null ? "installed" : "MISSING"}`);
  console.log(`  Caveman rule.md: ${(await readTextIfExists(cavemanRule)) !== null ? "installed" : "MISSING"}`);

  // RTK extension
  const rtkIndex = path.join(extDir, "rtk-session", "index.js");
  console.log(`  RTK extension: ${(await readTextIfExists(rtkIndex)) !== null ? "installed" : "MISSING"}`);

  // Updater
  const updaterIndex = path.join(extDir, "ai-addons-updater", "index.js");
  console.log(`  Updater extension: ${(await readTextIfExists(updaterIndex)) !== null ? "installed" : "MISSING"}`);

  // Combo
  const comboIndex = path.join(extDir, "combo-toggle", "index.js");
  console.log(`  Combo extension: ${(await readTextIfExists(comboIndex)) !== null ? "installed" : "MISSING"}`);

  const modeReinforcement = path.join(extDir, "shared", "mode-reinforcement.js");
  console.log(`  Mode reinforcement extension: ${(await readTextIfExists(modeReinforcement)) !== null ? "installed" : "MISSING"}`);

  // Amanai reward detector
  const amanaiRewardIndex = path.join(extDir, "amanai-reward", "index.js");
  const amanaiViaPlugin = selfDep && (await readTextIfExists(selfPkg)) !== null;
  const amanaiState = (await readTextIfExists(amanaiRewardIndex)) !== null ? "installed" : amanaiViaPlugin ? "installed (via plugin manifest)" : "MISSING";
  console.log(`  Amanai reward detector: ${amanaiState}`);

  if (configOk) {
    const configText = (await readTextIfExists(configPath))!;
    const hasComboPath = configText.includes("combo-toggle");
    console.log(`  Combo in config.yml: ${hasComboPath ? "registered" : "MISSING"}`);
  }
}

// --- Uninstall ---

interface UninstallOptions {
  yes?: boolean;
  removePonytail?: boolean;
  removeRtk?: boolean;
  dryRun?: boolean;
}

async function runUninstall(options: UninstallOptions = {}): Promise<boolean> {
  const confirmed = options.yes ?? yes;
  const shouldRemovePonytail = options.removePonytail ?? removePonytail;
  const shouldRemoveRtk = options.removeRtk ?? removeRtk;
  const shouldDryRun = options.dryRun ?? dryRun;

  console.log("\n=== Tersio Uninstall ===\n");

  const extDir = path.join(HOME, ".omp", "agent", "extensions");
  const configPath = path.join(HOME, ".omp", "agent", "config.yml");
  const rtkBin = path.join(HOME, ".bun", "bin", IS_WINDOWS ? "rtk.exe" : "rtk");

  const targets = [
    path.join(extDir, "caveman-session"),
    path.join(extDir, "rtk-session"),
    path.join(extDir, "ai-addons-updater"),
    path.join(extDir, "combo-toggle"),
    path.join(extDir, "shared"),
    path.join(extDir, "amanai-reward"),
    // Legacy always-on combo helper; imports shared/session-state.js, so it
    // breaks with a module-not-found warning once the shared dir is removed.
    path.join(extDir, "aaa-combo-boot"),
  ];

  console.log("Will remove:");
  for (const t of targets) {
    console.log(`  ${t}`);
  }

  if (shouldRemoveRtk) {
    console.log(`  ${rtkBin}`);
  }

  if (!confirmed) {
    const answer = await ask("\nProceed? [y/N]: ");
    if (!answer.toLowerCase().startsWith("y")) {
      console.log("Aborted.");
      closeRL();
      return false;
    }
  }

  // Remove extension directories
  for (const t of targets) {
    try {
      if (shouldDryRun) console.log(`  [dry-run] would remove ${t}`);
      else {
        await fs.rm(t, { recursive: true, force: true });
        console.log(`  [rm] ${t}`);
      }
    } catch {
      debug(`Could not remove ${t}`);
    }
  }

  // Remove Combo and mode-reinforcement registrations; Ponytail only when requested.
  const configRaw = await readTextIfExists(configPath);
  if (configRaw) {
    let lines = configRaw.split("\n");
    const before = lines.length;
    lines = lines.filter((l) => {
      if (l.includes("combo-toggle") || l.includes("mode-reinforcement")) return false;
      if (shouldRemovePonytail && l.includes("ponytail") && l.includes("pi-extension")) return false;
      return true;
    });
    if (lines.length !== before) {
      if (shouldDryRun) console.log(`  [dry-run] would remove ${before - lines.length} config.yml entries`);
      else {
        await fs.writeFile(configPath, lines.join("\n"), "utf8");
        console.log(`  [write] Updated config.yml (removed ${before - lines.length} entries)`);
      }
    }
  }

  // Remove our plugin registration from ~/.omp/plugins
  const pluginsDir = path.join(HOME, ".omp", "plugins");
  const pluginsPkgPath = path.join(pluginsDir, "package.json");
  const pluginsPkgRaw = await readTextIfExists(pluginsPkgPath);
  if (pluginsPkgRaw) {
    try {
      const pkg = JSON.parse(pluginsPkgRaw) as { dependencies?: Record<string, string> };
      if (pkg.dependencies && PACKAGE_NAME in pkg.dependencies) {
        if (shouldDryRun) console.log(`  [dry-run] would remove ${PACKAGE_NAME} from ${pluginsPkgPath}`);
        else {
          delete pkg.dependencies[PACKAGE_NAME];
          await fs.writeFile(pluginsPkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
          console.log(`  [write] Removed ${PACKAGE_NAME} from plugins/package.json`);
        }
      }
    } catch {
      debug("Could not update plugins/package.json");
    }
  }
  const selfPluginDir = path.join(pluginsDir, "node_modules", PACKAGE_NAME);
  if ((await readTextIfExists(path.join(selfPluginDir, "package.json"))) !== null) {
    try {
      if (shouldDryRun) console.log(`  [dry-run] would remove ${selfPluginDir}`);
      else {
        await fs.rm(selfPluginDir, { recursive: true, force: true });
        console.log(`  [rm] ${selfPluginDir}`);
      }
    } catch {
      debug(`Could not remove ${selfPluginDir}`);
    }
  }

  // Remove RTK binary if requested
  if (shouldRemoveRtk) {
    try {
      if (shouldDryRun) console.log(`  [dry-run] would remove ${rtkBin}`);
      else {
        await fs.unlink(rtkBin);
        console.log(`  [rm] ${rtkBin}`);
      }
    } catch {
      debug(`Could not remove ${rtkBin}`);
    }
  }

  console.log("\nDone. Restart OMP for changes to take effect.");
  return true;
}

async function runLatestUpdate(): Promise<void> {
  const updateScope = scopeFlag || "user";
  if (!["user", "project", "both"].includes(updateScope)) {
    console.error(`[fail] Invalid --scope: ${updateScope}. Use: user, project, both`);
    process.exitCode = 1;
    return;
  }

  const forwardedArgs = ["--yes", "--scope", updateScope];
  if (dryRun) forwardedArgs.push("--dry-run");
  if (verbose) forwardedArgs.push("--verbose");

  const npmArgs = [
    "exec",
    "--yes",
    "--prefer-online",
    `--package=${PACKAGE_NAME}@latest`,
    "--",
    PACKAGE_BIN,
    "--apply-update",
    ...forwardedArgs,
  ];

  const npmCommand = IS_WINDOWS ? process.env.ComSpec || "cmd.exe" : "npm";
  const npmCommandArgs = IS_WINDOWS ? ["/d", "/s", "/c", "npm", ...npmArgs] : npmArgs;

  console.log("=== Updating Tersio ===");
  console.log(`  Running the latest ${PACKAGE_NAME} installer...\n`);

  try {
    const result = await execP(npmCommand, npmCommandArgs, {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      shell: false,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    console.log("\n=== Update complete ===");
  } catch (e) {
    const err = e as Error & { stdout?: string; stderr?: string };
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    console.error(`\n[fail] Could not run ${PACKAGE_NAME}@latest: ${err.message}`);
    process.exitCode = 1;
  }
}

// --- Install profile (session-start mode defaults) ---

function defaultProfile(): Profile {
  return {
    comboDefault: "off",
    cavemanDefault: "off",
    rtkDefault: false,
  };
}

function tty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function resolveProfile(): Promise<Profile> {
  const profile = defaultProfile();

  // Interactive prompt: only for a real user at a terminal, only when no
  // default flags were given, and never for --apply-update runs.
  if (tty() && !profileFlagsGiven && !applyUpdate && (install || reinstall)) {
    const comboAnswer = (await ask("  Default Combo preset on session start? [off/medium/balanced/max] (off): ")).trim().toLowerCase();
    if (comboAnswer && comboAnswer in COMBO_DEFAULTS) profile.comboDefault = comboAnswer;
    const cavemanAnswer = (await ask("  Default Caveman mode on session start? [off/lite/full/ultra/wenyan] (off): ")).trim().toLowerCase();
    if (cavemanAnswer && cavemanAnswer in CAVEMAN_DEFAULTS) profile.cavemanDefault = cavemanAnswer;
    const rtkAnswer = (await ask("  Default RTK state on session start? [on/off] (off): ")).trim().toLowerCase();
    if (rtkAnswer === "on" || rtkAnswer === "off") profile.rtkDefault = rtkAnswer === "on";
  }

  // Explicit flags always win over the prompt.
  if (comboDefaultFlag !== undefined) profile.comboDefault = comboDefaultFlag;
  if (cavemanDefaultFlag !== undefined) profile.cavemanDefault = cavemanDefaultFlag;
  if (rtkDefaultFlag !== undefined) profile.rtkDefault = rtkDefaultFlag === "on";

  console.log(`  Profile: combo default=${profile.comboDefault} · caveman default=${profile.cavemanDefault} · rtk default=${profile.rtkDefault ? "on" : "off"}`);
  return profile;
}

// Persist the profile as omp plugin settings so `omp plugin config get`
// reflects the choice and the extensions pick it up on session start.
async function writePluginSettings(profile: Profile, options: WriteOptions): Promise<void> {
  const pluginsDir = path.join(HOME, ".omp", "plugins");
  const lockPath = path.join(pluginsDir, "omp-plugins.lock.json");
  let config: { plugins?: Record<string, unknown>; settings?: Record<string, Record<string, unknown>> } = {};
  const existing = await readTextIfExists(lockPath);
  if (existing) {
    try { config = JSON.parse(existing); } catch { config = {}; }
  }
  config.plugins = config.plugins || {};
  config.settings = config.settings || {};
  const settings = { ...(config.settings[PACKAGE_NAME] || {}) };
  settings.comboDefault = profile.comboDefault;
  settings.cavemanDefault = profile.cavemanDefault;
  settings.rtkDefault = profile.rtkDefault;
  config.settings[PACKAGE_NAME] = settings;

  if (options.dryRun) {
    console.log(`  [dry-run] would write plugin settings (${PACKAGE_NAME}) to ${lockPath}`);
    return;
  }
  await fs.mkdir(pluginsDir, { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(`  [write] Plugin settings in ${lockPath}`);
}

// --- Main ---

async function main(): Promise<void> {
  if (showVersion) {
    console.log(PACKAGE_VERSION);
    closeRL();
    return;
  }

  if (showHelp) {
    printHelp();
    closeRL();
    return;
  }

  if (unknownCommand) {
    console.error(`Unknown command: ${commandArg}`);
    printHelp();
    process.exitCode = 1;
    closeRL();
    return;
  }

  if (update && !applyUpdate) {
    await runLatestUpdate();
    closeRL();
    return;
  }

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

  if (reinstall) {
    await runUninstall({ yes: true, removePonytail: false, removeRtk: true });
  }

  if (dryRun) console.log("[dry-run] No changes will be written.\n");

  console.log(`=== Tersio v${PACKAGE_VERSION} ===`);
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Arch: ${process.arch}`);
  console.log(`  Home: ${HOME}`);

  // Determine install scope
  let scope: string;
  if (reinstall) {
    scope = "1";
    console.log("  Scope: user (reinstall)");
  } else if (scopeFlag) {
    const map: Record<string, string> = { user: "1", project: "2", both: "3" };
    scope = map[scopeFlag];
    if (!scope) {
      console.log(`  [fail] Invalid --scope: ${scopeFlag}. Use: user, project, both`);
      closeRL();
      process.exit(1);
    }
    console.log(`  Scope: ${scopeFlag}`);
  } else if (install || yes) {
    scope = "1";
    console.log(`  Scope: user (${install ? "install default" : "--scope omitted, defaulting to user with --yes"})`);
  } else {
    console.log("\nInstall scope:");
    console.log("  1) User-level (all OMP sessions)");
    console.log("  2) Project-level (this repo only)");
    console.log("  3) Both");
    scope = (await ask("\nChoose [1-3] (default 1): ")).trim() || "1";
  }


  // Resolve session defaults: flags > interactive prompt > defaults.
  const profile = await resolveProfile();


  const userDir = path.join(HOME, ".omp", "agent");
  const userExtDir = path.join(userDir, "extensions");
  const userPluginsDir = path.join(userDir, "..", "plugins");
  const bunBinDir = path.join(HOME, ".bun", "bin");
  const projectExtDir = path.join(process.cwd(), ".omp", "extensions");

  const options: InstallOptions = { dryRun, verbose, yes, scope, reinstall };

  // Check prerequisites
  console.log("\nPrerequisites:");
  try {
    const v = (await execP(IS_WINDOWS ? "omp.cmd" : "omp", ["--version"])).stdout.trim();
    console.log(`  [ok] omp ${v}`);
  } catch {
    console.log("  [fail] omp not found — ensure it's installed");
  }

  if (scope === "1" || scope === "3") {
    console.log("\n--- User-level install ---");
    await stepSharedSessionState(userExtDir, options);
    await stepPonytail(userPluginsDir, userDir, options);
    const selfPlugin = await stepSelfPlugin(userPluginsDir, options);
    const ponytailExtPath = path.join(userPluginsDir, "node_modules", "@dietrichgebert", "ponytail", "pi-extension", "index.js");
    await stepRtk(bunBinDir, options);
    await stepRtkSession(userExtDir, options);
    await stepCaveman(userExtDir, options);
    await stepCombo(userExtDir, options);
    await stepModeReinforcement(userExtDir, ponytailExtPath, options);
    await stepUpdater(userExtDir, options);
    await stepAmanaiReward(userExtDir, options, selfPlugin);
    if (selfPlugin) await writePluginSettings(profile, options);
  }

  if (scope === "2" || scope === "3") {
    console.log("\n--- Project-level install ---");
    await stepSharedSessionState(projectExtDir, options);
    await stepRtkSession(projectExtDir, options);
    await stepCaveman(projectExtDir, options);
    await stepUpdater(projectExtDir, options);
    await stepAmanaiReward(projectExtDir, options);
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
