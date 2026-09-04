#!/usr/bin/env node
// tersio.ts — Install Tersio (caveman/rtk/ponytail) add-ons on any OMP device.
// Usage: node tersio.js [install|update|reinstall|doctor|uninstall|version|help] [options]
// Requires: node/npm and omp CLI

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

import {
  CAVEMAN_REMOTE_RULE,
  RTK_RELEASE_API,
  findFile,
  httpsGet,
  httpsDownload,
  sha256File,
  parseChecksum,
  readTextIfExists,
  rtkPlatformSpec,
  withResolvers,
} from './extensions/lib/utils.ts';

const IS_WINDOWS = process.platform === 'win32';
const HOME = process.env.HOME || process.env.USERPROFILE || '';

const PACKAGE_NAME = '@krtclcdy/tersio';
const PACKAGE_BIN = 'tersio';
const { version: PACKAGE_VERSION } = createRequire(import.meta.url)('./package.json') as { version: string };

// --- Types ---

interface InstallOptions {
  dryRun: boolean;
  verbose: boolean;
  yes: boolean;
  scope: string;
  reinstall: boolean;
}

interface PluginsPackage {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

// Session-start mode defaults for fresh installs.
const COMBO_DEFAULTS = new Set(['off', 'medium', 'balanced', 'max']);
const CAVEMAN_DEFAULTS = new Set(['off', 'lite', 'full', 'ultra', 'wenyan']);
const PONYTAIL_DEFAULTS = new Set(['off', 'lite', 'full', 'ultra', 'review']);

// ponytail: Combo preset implies all three modes. Mirrors COMBO_LEVELS in
// extensions/shared/session-state.ts (rtk as boolean here). Single source.
const COMBO_PRESET_MODES: Record<string, { caveman: string; rtk: boolean; ponytail: string }> = {
  off: { caveman: 'off', rtk: false, ponytail: 'off' },
  medium: { caveman: 'lite', rtk: true, ponytail: 'lite' },
  balanced: { caveman: 'full', rtk: true, ponytail: 'full' },
  max: { caveman: 'ultra', rtk: true, ponytail: 'ultra' },
};

interface Profile {
  comboDefault: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
}

function parseEnum(value: string | undefined, valid: Set<string>, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (!valid.has(v)) {
    console.error(`[fail] Invalid ${flag}: ${value}. Valid: ${[...valid].join(', ')}`);
    process.exit(1);
  }
  return v;
}

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i !== -1) return args[i + 1];
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

// --- CLI flags ---

const COMMANDS = new Set(['install', 'update', 'reinstall', 'doctor', 'uninstall', 'version', 'help']);
const args = process.argv.slice(2);
const commandArg = args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--scope');
const command = commandArg?.toLowerCase() || null;
const unknownCommand = command !== null && !COMMANDS.has(command);
const install = command === 'install';
const update = command === 'update';
const reinstall = command === 'reinstall';
const showVersion = command === 'version' || args.includes('--version') || args.includes('-v');
const showHelp = command === 'help' || args.includes('--help') || args.includes('-h');
const applyUpdate = args.includes('--apply-update');
const dryRun = args.includes('--dry-run');
const yes = args.includes('--yes') || args.includes('-y') || install || update || reinstall || applyUpdate;
const verbose = args.includes('--verbose');
const doctor = command === 'doctor' || args.includes('--doctor');
const uninstall = command === 'uninstall' || args.includes('--uninstall');
const removePonytail = args.includes('--remove-ponytail');
const removeRtk = args.includes('--remove-rtk');

const scopeFlag = flagValue('--scope')?.toLowerCase() ?? null;

// --- Profile selection (session-start mode defaults) ---

const comboDefaultFlag = parseEnum(flagValue('--combo-default'), COMBO_DEFAULTS, '--combo-default');
const cavemanDefaultFlag = parseEnum(flagValue('--caveman-default'), CAVEMAN_DEFAULTS, '--caveman-default');
const ponytailDefaultFlag = parseEnum(flagValue('--ponytail-default'), PONYTAIL_DEFAULTS, '--ponytail-default');
const rtkDefaultFlag = flagValue('--rtk-default')?.toLowerCase();

if (rtkDefaultFlag !== undefined && rtkDefaultFlag !== 'on' && rtkDefaultFlag !== 'off') {
  console.error(`[fail] Invalid --rtk-default: ${rtkDefaultFlag}. Use: on, off`);
  process.exit(1);
}

const profileFlagsGiven = comboDefaultFlag !== undefined
  || cavemanDefaultFlag !== undefined || rtkDefaultFlag !== undefined
  || ponytailDefaultFlag !== undefined;

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
  --remove-ponytail (uninstall: also remove the Ponytail plugin)
  --remove-rtk (uninstall: also remove the RTK binary)
  --combo-default off|medium|balanced|max (implies caveman, rtk, ponytail)
  --caveman-default off|lite|full|ultra|wenyan (override; default follows combo)
  --ponytail-default off|lite|full|ultra|review (override; default follows combo)
  --rtk-default on|off (override; default follows combo)
  --yes, -y
  --dry-run
  --verbose
  --version, -v
  --help, -h`);
}

function debug(...a: unknown[]): void {
  if (verbose) console.log('  [debug]', ...a);
}

const RL = readline.createInterface({ input: process.stdin, output: process.stdout });
let rlOpen = true;
function ask(q: string): Promise<string> {
  const { promise, resolve } = withResolvers<string>();
  RL.question(q, resolve);
  return promise;
}
function closeRL(): void { if (rlOpen) { RL.close(); rlOpen = false; } }

// Paths to extension source files (relative to this script)
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.join(SCRIPT_DIR, 'extensions');
const SHARED_SESSION_STATE = path.join(EXT_DIR, 'shared', 'session-state.js');
const CAVEMAN_INDEX = path.join(EXT_DIR, 'caveman-session', 'index.js');
const RTK_SESSION_INDEX = path.join(EXT_DIR, 'rtk-session', 'index.js');
const UPDATER_INDEX = path.join(EXT_DIR, 'ai-addons-updater', 'index.js');
const COMBO_TOGGLE_INDEX = path.join(EXT_DIR, 'combo-toggle', 'index.js');
const MODE_REINFORCEMENT_INDEX = path.join(EXT_DIR, 'shared', 'mode-reinforcement.js');
const SHARED_TYPES = path.join(EXT_DIR, 'shared', 'types.js');
const LIB_UTILS = path.join(EXT_DIR, 'lib', 'utils.js');
const SHARED_PLUGIN_SETTINGS = path.join(EXT_DIR, 'shared', 'plugin-settings.js');

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
    encoding: 'utf8',
    ...opts,
  }) as Promise<{ stdout: string; stderr: string }>;
}

interface WriteOptions {
  dryRun?: boolean;
}

async function backupFile(filePath: string): Promise<void> {
  await fs.copyFile(filePath, `${filePath}.bak`).catch(() => {});
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
  await fs.writeFile(dest, content, 'utf8');
  console.log(`  [write] ${dest}`);
  return true;
}

// omp ships 'extensions: null'; appending list items under a null scalar breaks
// YAML parsing. Normalize null/~/[]/empty to a mapping key first.
const EXTENSIONS_NULL_RE = /^\s*extensions\s*:\s*(?:\[\s*\]|null|~)?\s*$/i;

function normalizeExtensionsKey(lines: string[]): boolean {
  const idx = lines.findIndex((l) => EXTENSIONS_NULL_RE.test(l));
  if (idx === -1) return false;
  lines[idx] = 'extensions:';
  return true;
}

async function ensureExtensionInConfig(configPath: string, extensionPath: string, label: string, options: WriteOptions = {}): Promise<boolean> {
  const normalizedPath = extensionPath.replace(/\\/g, '/');
  const line = `  - ${normalizedPath}`;

  const raw = await readTextIfExists(configPath);
  let lines = (raw || '').split('\n');

  if (lines.some((l) => l.includes(normalizedPath))) {
    debug(`${label} already in config.yml`);
    return false;
  }

  const extLineIdx = lines.findIndex((l) => /^\s*extensions\s*:/i.test(l));

  if (options.dryRun) {
    console.log(`  [dry-run] would add ${label} to config.yml: ${normalizedPath}`);
    return true;
  }

  if (normalizeExtensionsKey(lines)) {
    lines.splice(lines.findIndex((l) => /^\s*extensions\s*:/i.test(l)) + 1, 0, line, '');
  } else if (extLineIdx === -1) {
    lines.push('extensions:');
    lines.push(line);
    lines.push('');
  } else {
    lines.splice(extLineIdx + 1, 0, line);
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await backupFile(configPath);
  await fs.writeFile(configPath, lines.join('\n'), 'utf8');
  console.log(`  [write] Added ${label} to config.yml`);
  return true;
}

async function ensureExtensionAfterConfigEntry(configPath: string, extensionPath: string, afterPath: string, label: string, options: WriteOptions = {}): Promise<boolean> {
  const normalizedPath = extensionPath.replace(/\\/g, '/');
  const normalizedAfterPath = afterPath.replace(/\\/g, '/');
  const line = `  - ${normalizedPath}`;
  const raw = await readTextIfExists(configPath);
  const lines = (raw || '').split('\n');
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
      lines.push('extensions:', line, '');
    } else {
      normalizeExtensionsKey(lines);
      lines.splice(extensionsIndex + 1, 0, line);
    }
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await backupFile(configPath);
  await fs.writeFile(configPath, lines.join('\n'), 'utf8');
  console.log(`  [write] Placed ${label} after Ponytail in config.yml`);
  return true;
}

function readPonytailConfig(): { dir: string; path: string } {
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'ponytail')
    : path.join(HOME, '.config', 'ponytail');
  return { dir, path: path.join(dir, 'config.json') };
}

interface PonytailConfig {
  defaultMode?: string;
  hideStatus?: boolean;
  [key: string]: unknown;
}

function parsePonytailConfig(existing: string | null): PonytailConfig {
  if (!existing) return {};
  try {
    const cfg: unknown = JSON.parse(existing.replace(/^\uFEFF/, ''));
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return {};
    return cfg as PonytailConfig;
  } catch {
    return {};
  }
}

async function patchPonytailConfig(
  apply: (cfg: PonytailConfig) => boolean,
  dryRunNote: string,
  writeNote: string,
  options: WriteOptions = {},
): Promise<void> {
  const config = readPonytailConfig();
  if (options.dryRun) {
    console.log(`  [dry-run] ${dryRunNote} in ${config.path}`);
    return;
  }
  const cfg = parsePonytailConfig(await readTextIfExists(config.path));
  if (!apply(cfg)) {
    debug('Ponytail config already up to date');
    return;
  }
  await fs.mkdir(config.dir, { recursive: true });
  await fs.writeFile(config.path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log(`  [write] ${writeNote} in ${config.path}`);
}

async function ensurePonytailDefaultOff(options: WriteOptions = {}): Promise<void> {
  await patchPonytailConfig((cfg) => {
    if (cfg.defaultMode === 'off') return false;
    cfg.defaultMode = 'off';
    return true;
  }, 'would set Ponytail defaultMode=off', 'Set Ponytail defaultMode=off', options);
}

// Sets ~/.config/ponytail/config.json#hideStatus=true so the upstream ponytail
// status bar doesn't render — the combo extension owns the bar instead.
async function ensurePonytailHideStatus(options: WriteOptions = {}): Promise<void> {
  await patchPonytailConfig((cfg) => {
    if (cfg.hideStatus === true) return false;
    cfg.hideStatus = true;
    return true;
  }, 'would set Ponytail hideStatus=true', 'Set Ponytail hideStatus=true', options);
}



// --- Steps ---

async function stepPonytail(pluginsDir: string, userDir: string, options: InstallOptions): Promise<void> {
  console.log('\n[1/7] Installing Ponytail plugin...');
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, 'package.json');
  let pkg: PluginsPackage = {};
  const existing = await readTextIfExists(pkgPath);
  if (existing) {
    try { pkg = JSON.parse(existing); } catch { pkg = {}; }
  }

  pkg.name = pkg.name || 'omp-plugins';
  pkg.private = true;
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies['@dietrichgebert/ponytail'] = 'github:DietrichGebert/ponytail';

  if (options.dryRun) {
    console.log(`  [dry-run] would write ${pkgPath}`);
  } else {
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('  [write] package.json');
  }

  const ponytailExtPath = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  // Fast path: extension already present and no refresh asked — skip network.
  let ponytailExtExists: string | null = !options.reinstall && !options.dryRun
    ? await readTextIfExists(ponytailExtPath)
    : null;
  if (ponytailExtExists) {
    debug('Ponytail pi-extension already installed; skipping network refresh');
  } else if (options.dryRun) {
    // Dry runs preview the wiring below without touching the network.
    console.log('  [dry-run] would run: omp plugin install github:DietrichGebert/ponytail');
    if (options.reinstall) {
      console.log('  [dry-run] would run: npm install @dietrichgebert/ponytail@latest --save --no-audit --no-fund');
    }
    ponytailExtExists = 'dry-run';
  } else {
    // Try omp plugin install first
    try {
      await execP(IS_WINDOWS ? 'omp.cmd' : 'omp', ['plugin', 'install', 'github:DietrichGebert/ponytail'], { cwd: pluginsDir });
      console.log('  [ok] omp plugin install ran');
    } catch (e) {
      console.log(`  [warn] omp plugin install failed: ${(e as Error).message}`);
    }

    if (options.reinstall) {
      try {
        await execP('npm', ['install', '@dietrichgebert/ponytail@latest', '--save', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 120000 });
        console.log('  [ok] Ponytail refreshed');
      } catch (e) {
        console.log(`  [fail] Could not refresh ponytail: ${(e as Error).message}`);
        console.log('  [hint] Manual: cd ~/.omp/plugins && npm install @dietrichgebert/ponytail@latest --save --no-audit --no-fund');
      }
    }

    // Verify the pi-extension/index.js actually exists
    ponytailExtExists = await readTextIfExists(ponytailExtPath);

    // Fallback: try bun install or npm install
    if (!ponytailExtExists) {
      console.log('  [info] pi-extension/index.js not found after omp plugin install — trying npm/bun install...');
      try {
        await execP('npm', ['install'], { cwd: pluginsDir, timeout: 120000 });
        console.log('  [ok] npm install completed');
      } catch {
        try {
          await execP('bun', ['install'], { cwd: pluginsDir, timeout: 120000 });
          console.log('  [ok] bun install completed');
        } catch (e2) {
          console.log(`  [fail] Could not install ponytail: ${(e2 as Error).message}`);
          console.log('  [hint] Manual: cd ~/.omp/plugins && npm install');
        }
      }
      ponytailExtExists = await readTextIfExists(ponytailExtPath);
    }

    // Last-resort fallback: git clone the repo into node_modules
    if (!ponytailExtExists) {
      console.log('  [info] npm/bun did not produce pi-extension — trying git clone...');
      try {
        const dest = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail');
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await execP('git', ['clone', '--depth', '1', 'https://github.com/DietrichGebert/ponytail.git', dest], { timeout: 180000 });
        console.log('  [ok] git clone completed');
        ponytailExtExists = await readTextIfExists(ponytailExtPath);
      } catch (e3) {
        console.log(`  [fail] git clone failed: ${(e3 as Error).message}`);
        console.log('  [hint] Install git or check network: https://github.com/DietrichGebert/ponytail');
      }
    }
  }

  if (!ponytailExtExists) {
    console.log('  [skip] Ponytail pi-extension/index.js still not found — skill-only mode');
    console.log('  [hint] The /ponytail command won\'t work, but ponytail skills will still load');
  } else if (!options.dryRun) {
    // Wire extension into config.yml so /ponytail command loads
    console.log('  [ok] Ponytail pi-extension found');
  }
  // Still set Ponytail config defaults even without the extension command
  const configPath = path.join(userDir, 'config.yml');
  await ensureExtensionInConfig(configPath, ponytailExtPath, 'ponytail', options);
  await ensurePonytailDefaultOff(options);
  await ensurePonytailHideStatus(options);
}

// Registers this package in ~/.omp/plugins so OMP lists it on the
// Settings → Plugins page (OMP enumerates plugins/package.json dependencies).
// Returns true when the package is verified in plugins/node_modules.
async function stepSelfPlugin(pluginsDir: string, options: InstallOptions): Promise<boolean> {
  console.log('\n[2/7] Registering tersio as OMP plugin...');
  const pkgPath = path.join(pluginsDir, 'package.json');
  let pkg: PluginsPackage = {};
  const existing = await readTextIfExists(pkgPath);
  if (existing) {
    try { pkg = JSON.parse(existing); } catch { pkg = {}; }
  }
  pkg.name = pkg.name || 'omp-plugins';
  pkg.private = true;
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies[PACKAGE_NAME] = `^${PACKAGE_VERSION}`;
  for (const legacy of ['oh-my-pi-token-saver', 'tersio-omp']) {
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

  if (!options.reinstall && pkg.dependencies[PACKAGE_NAME]) {
    const installedRaw = await readTextIfExists(path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json'));
    if (installedRaw) {
      try {
        if ((JSON.parse(installedRaw) as { version?: string }).version === PACKAGE_VERSION) {
          debug(`${PACKAGE_NAME} already installed at v${PACKAGE_VERSION}; skipping npm install`);
          console.log('  [ok] Listed in OMP Settings → Plugins as tersio');
          return true;
        }
      } catch { /* fall through to install */ }
    }
  }

  await fs.mkdir(pluginsDir, { recursive: true });
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  try {
    await execP('npm', ['install', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 180000 });
  } catch {
    try {
      await execP('bun', ['install'], { cwd: pluginsDir, timeout: 180000 });
    } catch (e) {
      console.log(`  [fail] Could not install ${PACKAGE_NAME} into plugins dir: ${(e as Error).message}`);
      console.log(`  [hint] Manual: cd ~/.omp/plugins && npm install ${PACKAGE_NAME}@^${PACKAGE_VERSION} --save --no-audit --no-fund`);
      return false;
    }
  }

  const installedPkg = path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json');
  if ((await readTextIfExists(installedPkg)) === null) {
    console.log(`  [warn] ${PACKAGE_NAME} not found in plugins/node_modules after install`);
    return false;
  }
  console.log('  [ok] Listed in OMP Settings → Plugins as tersio');
  return true;
}

interface RtkAsset { name: string; browser_download_url: string }
interface RtkRelease { tag_name: string; assets?: RtkAsset[] }

function resolveRtkTriple(): string | null {
  const triple = rtkPlatformSpec()?.triple;
  if (triple) return triple;
  console.log(`  [fail] Unsupported platform: ${process.platform}/${process.arch}`);
  console.log('  [hint] Manual: https://github.com/rtk-ai/rtk/releases');
  return null;
}

function findRtkAsset(release: RtkRelease, triple: string): RtkAsset | null {
  const assets = release.assets || [];
  const asset = assets.find((a) => a.name === `rtk-${triple}.zip` || a.name === `rtk-${triple}.tar.gz`);
  if (asset) return asset;
  console.log(`  [fail] No rtk-${triple}.<zip|tar.gz> in release ${release.tag_name}`);
  console.log(`  [hint] Available: ${assets.map((a) => a.name).filter((n) => n.startsWith('rtk-')).join(', ')}`);
  return null;
}

async function downloadRtkChecksums(release: RtkRelease): Promise<string | null> {
  const checksumsAsset = (release.assets || []).find((a) => a.name === 'checksums.txt');
  if (!checksumsAsset) return null;
  try {
    return await httpsGet(checksumsAsset.browser_download_url);
  } catch (e) {
    debug(`Could not download checksums.txt: ${(e as Error).message}`);
    return null;
  }
}

async function verifyRtkArchive(archivePath: string, assetName: string, checksumsText: string | null, tmpDir: string): Promise<boolean> {
  if (!checksumsText) {
    console.log('  [warn] No checksums.txt available — skipping verification');
    return true;
  }
  const expected = parseChecksum(checksumsText, assetName);
  const actual = await sha256File(archivePath);
  if (!expected) {
    console.log(`  [warn] checksums.txt missing entry for ${assetName} — skipping verification`);
    return true;
  }
  if (actual === expected) {
    console.log(`  [ok] Checksum verified for ${assetName}`);
    return true;
  }
  console.log(`  [fail] Checksum mismatch for ${assetName}`);
  console.log(`  [fail] Expected: ${expected}`);
  console.log(`  [fail] Got:      ${actual}`);
  await fs.rm(tmpDir, { recursive: true, force: true });
  return false;
}

function shortError(e: unknown): string {
  return (((e as Error & { stderr?: string }).stderr) || (e as Error).message || '').trim().slice(0, 200);
}

async function extractRtkArchive(archivePath: string, extractDir: string): Promise<boolean> {
  await fs.mkdir(extractDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    if (IS_WINDOWS) {
      await execP('powershell', ['Expand-Archive', '-Path', archivePath, '-DestinationPath', extractDir, '-Force'], { timeout: 60000 });
    } else {
      await execP('unzip', [archivePath, '-d', extractDir], { timeout: 60000 });
    }
    return true;
  }
  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    try {
      await execP('tar', ['xzf', archivePath, '-C', extractDir], { timeout: 60000 });
      debug('tar xzf ok');
    } catch (e) {
      debug(`tar xzf failed: ${shortError(e)}`);
      console.log(`  [fail] tar could not extract ${path.basename(archivePath)}`);
      console.log('  [hint] Manual: https://github.com/rtk-ai/rtk/releases');
      return false;
    }
    return true;
  }
  console.log(`  [fail] Unknown archive format: ${archivePath}`);
  return false;
}

async function stepRtk(binDir: string, options: InstallOptions): Promise<void> {
  console.log('\n[3/7] Installing RTK binary...');
  try {
    const release = JSON.parse(await httpsGet(RTK_RELEASE_API)) as RtkRelease;
    const triple = resolveRtkTriple();
    if (!triple) return;
    const asset = findRtkAsset(release, triple);
    if (!asset) return;
    const binDest = path.join(binDir, IS_WINDOWS ? 'rtk.exe' : 'rtk');

    if (options.dryRun) {
      console.log(`  [dry-run] would download ${asset.name} from release ${release.tag_name}`);
      console.log('  [dry-run] would verify checksum against checksums.txt');
      console.log(`  [dry-run] would extract and install to ${binDest}`);
      return;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omp-rtk-'));
    try {
      const archivePath = path.join(tmpDir, asset.name);
      const [checksumsText] = await Promise.all([
        downloadRtkChecksums(release),
        httpsDownload(asset.browser_download_url, archivePath),
      ]);
      if (!await verifyRtkArchive(archivePath, asset.name, checksumsText, tmpDir)) return;

      const extractDir = path.join(tmpDir, 'extracted');
      if (!await extractRtkArchive(archivePath, extractDir)) return;

      const binaryName = IS_WINDOWS ? 'rtk.exe' : 'rtk';
      const found = await findFile(extractDir, binaryName);
      if (!found) {
        console.log(`  [fail] Could not find ${binaryName} in extracted archive`);
        return;
      }

      await fs.mkdir(path.dirname(binDest), { recursive: true });
      await fs.copyFile(binDest, `${binDest}.bak`).catch(() => {});
      await fs.copyFile(found, binDest);
      console.log(`  [write] ${binDest}`);

      if (!IS_WINDOWS) {
        await fs.chmod(binDest, 0o755);
        debug(`chmod 755 ${binDest}`);
      }

      try {
        const v = (await execP(binDest, ['--version'], { timeout: 10000, shell: false })).stdout.trim();
        console.log(`  [ok] ${binDest} → ${v}`);
      } catch {
        console.log(`  [hint] Verify manually: ${binDest} --version`);
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (e) {
    console.log(`  [fail] RTK: ${(e as Error).message}`);
    console.log('  [hint] Manual: https://github.com/rtk-ai/rtk/releases');
  }
}

// Copy repo source files into the target extension dir. First entry is
// required (skip label on missing); rest are optional companions.
async function copySources(extDir: string, files: Array<[string, string]>, skipLabel: string, options: WriteOptions): Promise<boolean> {
  const src = await readTextIfExists(files[0][0]);
  if (!src) {
    console.log(`  [skip] ${skipLabel} not found in repo`);
    return false;
  }
  await writeIfChanged(path.join(extDir, files[0][1]), src, options);
  for (const [from, to] of files.slice(1)) {
    const extra = await readTextIfExists(from);
    if (extra) await writeIfChanged(path.join(extDir, to), extra, options);
  }
  return true;
}

async function stepSharedSessionState(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, [
    [SHARED_SESSION_STATE, path.join('shared', 'session-state.js')],
    [SHARED_TYPES, path.join('shared', 'types.js')],
    [LIB_UTILS, path.join('lib', 'utils.js')],
    [SHARED_PLUGIN_SETTINGS, path.join('shared', 'plugin-settings.js')],
  ], 'shared/session-state.js', options);
}

async function stepModeReinforcement(extDir: string, ponytailExtPath: string, options: WriteOptions): Promise<void> {
  console.log('\n[7/7] Installing mode reinforcement extension...');
  const dest = path.join(extDir, 'shared', 'mode-reinforcement.js');
  if (!await copySources(extDir, [[MODE_REINFORCEMENT_INDEX, path.join('shared', 'mode-reinforcement.js')]], 'shared/mode-reinforcement.js', options)) return;
  await ensureExtensionAfterConfigEntry(path.join(path.dirname(extDir), 'config.yml'), dest, ponytailExtPath, 'mode reinforcement', options);
}

async function stepRtkSession(extDir: string, options: WriteOptions): Promise<void> {
  console.log('\n[4/7] Installing RTK session extension...');
  await copySources(extDir, [[RTK_SESSION_INDEX, path.join('rtk-session', 'index.js')]], 'rtk-session/index.js', options);
}

async function stepCaveman(extDir: string, options: WriteOptions): Promise<void> {
  console.log('\n[5/7] Installing Caveman session extension...');
  const cavemanDir = path.join(extDir, 'caveman-session');
  if (!options.dryRun) await fs.mkdir(cavemanDir, { recursive: true });

  // Dry runs stay offline; the bundled rule is enough to preview its destination.
  let rule: string | null = null;
  try {
    rule = options.dryRun ? await readTextIfExists(path.join(path.dirname(CAVEMAN_INDEX), 'rule.md')) || '' : await httpsGet(CAVEMAN_REMOTE_RULE);
  } catch (e) {
    console.log(`  [warn] Could not fetch caveman rule: ${(e as Error).message}`);
  }
  const ruleDest = path.join(cavemanDir, 'rule.md');
  if (rule === null && (await readTextIfExists(ruleDest)) !== null) {
    console.log('  [info] Keeping existing rule.md');
  } else if (rule === null) {
    console.log('  [skip] Caveman rule.md unavailable');
    console.log(`  [hint] Manual: ${CAVEMAN_REMOTE_RULE}`);
  } else {
    await writeIfChanged(ruleDest, rule, options);
  }

  await copySources(extDir, [[CAVEMAN_INDEX, path.join('caveman-session', 'index.js')]], 'caveman-session/index.js', options);
}

async function stepUpdater(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, [[UPDATER_INDEX, path.join('ai-addons-updater', 'index.js')]], 'ai-addons-updater/index.js', options);
}

async function stepCombo(extDir: string, options: WriteOptions): Promise<void> {
  console.log('\n[6/7] Installing Combo toggle extension...');
  const dest = path.join(extDir, 'combo-toggle', 'index.js');
  if (!await copySources(extDir, [[COMBO_TOGGLE_INDEX, path.join('combo-toggle', 'index.js')]], 'combo-toggle/index.js', options)) return;

  // Auto-register combo in config.yml
  const configPath = path.join(path.dirname(extDir), 'config.yml');
  await ensureExtensionInConfig(configPath, dest, 'combo', options);
}


// --- Doctor ---

async function runDoctor(): Promise<void> {
  console.log('\n=== Tersio Doctor ===\n');

  // Node
  console.log(`  Node: ok ${process.version}`);

  // OMP CLI
  try {
    const v = (await execP(IS_WINDOWS ? 'omp.cmd' : 'omp', ['--version'])).stdout.trim();
    console.log(`  OMP CLI: ok ${v}`);
  } catch {
    console.log('  OMP CLI: MISSING');
  }

  // Home
  console.log(`  Home: ${HOME}`);

  // Directories
  const agentDir = path.join(HOME, '.omp', 'agent');
  const extDir = path.join(agentDir, 'extensions');
  const configPath = path.join(agentDir, 'config.yml');
  const pluginsDir = path.join(HOME, '.omp', 'plugins');
  const rtkBin = path.join(HOME, '.bun', 'bin', IS_WINDOWS ? 'rtk.exe' : 'rtk');

  // Ponytail
  const ponytailPkg = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
  const ponytailExt = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  const cavemanIndex = path.join(extDir, 'caveman-session', 'index.js');
  const cavemanRule = path.join(extDir, 'caveman-session', 'rule.md');
  const rtkIndex = path.join(extDir, 'rtk-session', 'index.js');
  const updaterIndex = path.join(extDir, 'ai-addons-updater', 'index.js');
  const comboIndex = path.join(extDir, 'combo-toggle', 'index.js');
  const modeReinforcement = path.join(extDir, 'shared', 'mode-reinforcement.js');
  const selfPkg = path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json');

  // Independent probes run concurrently; logs below keep fixed order.
  const [
    agentEntries,
    extEntries,
    sharedStateText,
    configText,
    ponytailPkgText,
    ponytailExtText,
    pluginsPkgRaw,
    selfPkgText,
    rtkBinText,
    cavemanIndexText,
    cavemanRuleText,
    rtkIndexText,
    updaterIndexText,
    comboIndexText,
    modeReinforcementText,
  ] = await Promise.all([
    fs.readdir(agentDir).catch(() => null),
    fs.readdir(extDir).catch(() => null),
    readTextIfExists(path.join(extDir, 'shared', 'session-state.js')),
    readTextIfExists(configPath),
    readTextIfExists(ponytailPkg),
    readTextIfExists(ponytailExt),
    readTextIfExists(path.join(pluginsDir, 'package.json')),
    readTextIfExists(selfPkg),
    readTextIfExists(rtkBin),
    readTextIfExists(cavemanIndex),
    readTextIfExists(cavemanRule),
    readTextIfExists(rtkIndex),
    readTextIfExists(updaterIndex),
    readTextIfExists(comboIndex),
    readTextIfExists(modeReinforcement),
  ]);

  const agentOk = agentEntries !== null;
  console.log(`  OMP agent dir: ${agentOk ? 'ok' : 'MISSING'} ${agentDir}`);

  const extOk = extEntries !== null;
  console.log(`  OMP extensions dir: ${extOk ? 'ok' : 'MISSING'} ${extDir}`);

  console.log(`  Shared session bridge: ${sharedStateText !== null ? 'installed' : 'MISSING'}`);

  const configOk = configText !== null;
  console.log(`  OMP config.yml: ${configOk ? 'ok' : 'MISSING'} ${configPath}`);

  const ponytailInstalled = ponytailPkgText !== null;
  const ponytailExtInstalled = ponytailExtText !== null;
  console.log(`  Ponytail package: ${ponytailInstalled ? 'installed' : 'MISSING'}`);
  console.log(`  Ponytail extension: ${ponytailExtInstalled ? 'installed' : 'MISSING'}`);

  if (configText) {
    const hasPonytailPath = configText.includes('ponytail') && configText.includes('pi-extension');
    console.log(`  Ponytail in config.yml: ${hasPonytailPath ? 'registered' : 'MISSING'}`);
  }

  // Self plugin registration (Settings → Plugins listing)
  let selfDep = false;
  if (pluginsPkgRaw) {
    try { selfDep = PACKAGE_NAME in ((JSON.parse(pluginsPkgRaw) as { dependencies?: Record<string, string> }).dependencies || {}); } catch { /* ignore */ }
  }
  console.log(`  Self plugin in plugins/package.json: ${selfDep ? 'registered' : 'MISSING'}`);
  console.log(`  Self plugin package: ${selfPkgText !== null ? 'installed' : 'MISSING'}`);

  // RTK
  const rtkExists = rtkBinText !== null;
  console.log(`  RTK binary: ${rtkExists ? 'installed' : 'MISSING'} ${rtkBin}`);
  if (rtkExists) {
    try {
      const v = (await execP(rtkBin, ['--version'], { timeout: 5000 })).stdout.trim();
      console.log(`  RTK version: ${v}`);
    } catch {
      console.log('  RTK version: unavailable (may not be executable)');
    }
  }

  // Caveman
  console.log(`  Caveman extension: ${cavemanIndexText !== null ? 'installed' : 'MISSING'}`);
  console.log(`  Caveman rule.md: ${cavemanRuleText !== null ? 'installed' : 'MISSING'}`);

  // RTK extension
  console.log(`  RTK extension: ${rtkIndexText !== null ? 'installed' : 'MISSING'}`);

  // Updater
  console.log(`  Updater extension: ${updaterIndexText !== null ? 'installed' : 'MISSING'}`);

  // Combo
  console.log(`  Combo extension: ${comboIndexText !== null ? 'installed' : 'MISSING'}`);

  console.log(`  Mode reinforcement extension: ${modeReinforcementText !== null ? 'installed' : 'MISSING'}`);


  if (configText) {
    const hasComboPath = configText.includes('combo-toggle');
    console.log(`  Combo in config.yml: ${hasComboPath ? 'registered' : 'MISSING'}`);
  }
}

// --- Uninstall ---

interface UninstallOptions {
  yes?: boolean;
  removePonytail?: boolean;
  removeRtk?: boolean;
  dryRun?: boolean;
}

// Read-modify-write a JSON file. mutate returns true when it changed
// something; no change (or unreadable file) means no output at all.
async function updateJsonFile(
  filePath: string,
  mutate: (data: Record<string, unknown>) => boolean,
  dryRunNote: string,
  writeNote: string,
  dryRun: boolean,
): Promise<void> {
  const raw = await readTextIfExists(filePath);
  if (!raw) return;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    debug(`Could not parse ${filePath}`);
    return;
  }
  if (!mutate(data)) return;
  if (dryRun) {
    console.log(`  [dry-run] ${dryRunNote}`);
    return;
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  [write] ${writeNote}`);
}

function dropKey(section: unknown, key: string): boolean {
  if (!section || typeof section !== 'object') return false;
  const record = section as Record<string, unknown>;
  if (!(key in record)) return false;
  delete record[key];
  return true;
}

async function runUninstall(options: UninstallOptions = {}): Promise<boolean> {
  const shouldDryRun = options.dryRun ?? dryRun;
  const confirmed = (options.yes ?? yes) || shouldDryRun;
  const shouldRemovePonytail = options.removePonytail ?? removePonytail;
  const shouldRemoveRtk = options.removeRtk ?? removeRtk;

  console.log('\n=== Tersio Uninstall ===\n');

  const extDir = path.join(HOME, '.omp', 'agent', 'extensions');
  const configPath = path.join(HOME, '.omp', 'agent', 'config.yml');
  const rtkBin = path.join(HOME, '.bun', 'bin', IS_WINDOWS ? 'rtk.exe' : 'rtk');
  const pluginsDir = path.join(HOME, '.omp', 'plugins');
  const ponytailPkgDir = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail');

  const targets = [
    path.join(extDir, 'caveman-session'),
    path.join(extDir, 'rtk-session'),
    path.join(extDir, 'ai-addons-updater'),
    path.join(extDir, 'combo-toggle'),
    path.join(extDir, 'shared'),
    // Only consumed by ai-addons-updater (removed above); otherwise orphaned.
    path.join(extDir, 'lib'),
    // Legacy always-on combo helper; imports shared/session-state.js, so it
    // breaks with a module-not-found warning once the shared dir is removed.
    path.join(extDir, 'aaa-combo-boot'),
  ];

  console.log('Will remove:');
  for (const t of targets) {
    console.log(`  ${t}`);
  }

  if (shouldRemovePonytail) {
    console.log(`  ${ponytailPkgDir} (ponytail plugin package)`);
  }

  if (shouldRemoveRtk) {
    console.log(`  ${rtkBin}`);
  }

  if (!confirmed) {
    const answer = await ask('\nProceed? [y/N]: ');
    if (!answer.toLowerCase().startsWith('y')) {
      console.log('Aborted.');
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
    let lines = configRaw.split('\n');
    const before = lines.length;
    lines = lines.filter((l) => {
      if (l.includes('combo-toggle') || l.includes('mode-reinforcement')) return false;
      if (shouldRemovePonytail && l.includes('ponytail') && l.includes('pi-extension')) return false;
      return true;
    });
    if (lines.length !== before) {
      if (shouldDryRun) console.log(`  [dry-run] would remove ${before - lines.length} config.yml entries`);
      else {
        await backupFile(configPath);
        await fs.writeFile(configPath, lines.join('\n'), 'utf8');
        console.log(`  [write] Updated config.yml (removed ${before - lines.length} entries)`);
      }
    }
  }

  // Remove the Ponytail plugin package the installer added (dep, files,
  // lock entry); the config.yml entry was filtered above.
  if (shouldRemovePonytail) {
    const pluginsPkgPath = path.join(pluginsDir, 'package.json');
    await updateJsonFile(pluginsPkgPath,
      (data) => dropKey(data.dependencies, '@dietrichgebert/ponytail'),
      `would remove @dietrichgebert/ponytail from ${pluginsPkgPath}`,
      'Removed @dietrichgebert/ponytail from plugins/package.json', shouldDryRun);
    try {
      if (shouldDryRun) console.log(`  [dry-run] would remove ${ponytailPkgDir}`);
      else {
        await fs.rm(ponytailPkgDir, { recursive: true, force: true });
        console.log(`  [rm] ${ponytailPkgDir}`);
        await fs.rm(path.dirname(ponytailPkgDir));
        console.log(`  [rm] ${path.dirname(ponytailPkgDir)} (empty scope)`);
      }
    } catch {
      debug('Could not remove ponytail package dir (scope may hold other packages)');
    }
    const lockPath = path.join(pluginsDir, 'omp-plugins.lock.json');
    await updateJsonFile(lockPath,
      (data) => dropKey(data.plugins, '@dietrichgebert/ponytail'),
      `would remove @dietrichgebert/ponytail from ${lockPath}`,
      `Removed @dietrichgebert/ponytail from ${lockPath}`, shouldDryRun);
  }

  // Remove our plugin registration from ~/.omp/plugins
  const pluginsPkgPath = path.join(pluginsDir, 'package.json');
  await updateJsonFile(pluginsPkgPath,
    (data) => dropKey(data.dependencies, PACKAGE_NAME),
    `would remove ${PACKAGE_NAME} from ${pluginsPkgPath}`,
    `Removed ${PACKAGE_NAME} from plugins/package.json`, shouldDryRun);
  const selfPluginDir = path.join(pluginsDir, 'node_modules', PACKAGE_NAME);
  if ((await readTextIfExists(path.join(selfPluginDir, 'package.json'))) !== null) {
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

  console.log('\nDone. Restart OMP for changes to take effect.');
  return true;
}

async function runLatestUpdate(): Promise<void> {
  const updateScope = scopeFlag || 'user';
  if (!['user', 'project', 'both'].includes(updateScope)) {
    console.error(`[fail] Invalid --scope: ${updateScope}. Use: user, project, both`);
    process.exitCode = 1;
    return;
  }

  const forwardedArgs = ['--yes', '--scope', updateScope];
  if (dryRun) forwardedArgs.push('--dry-run');
  if (verbose) forwardedArgs.push('--verbose');

  const npmArgs = [
    'exec',
    '--yes',
    '--prefer-online',
    `--package=${PACKAGE_NAME}@latest`,
    '--',
    PACKAGE_BIN,
    '--apply-update',
    ...forwardedArgs,
  ];

  const npmCommand = IS_WINDOWS ? process.env.ComSpec || 'cmd.exe' : 'npm';
  const npmCommandArgs = IS_WINDOWS ? ['/d', '/s', '/c', 'npm', ...npmArgs] : npmArgs;

  console.log('=== Updating Tersio ===');
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
    console.log('\n=== Update complete ===');
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
    comboDefault: 'off',
    cavemanDefault: 'off',
    rtkDefault: false,
    ponytailDefault: 'off',
  };
}

function tty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

const SCOPE_MAP: Record<string, string> = { user: '1', project: '2', both: '3' };

// Determine install scope: reinstall > flag > non-interactive default > prompt.
async function resolveScope(): Promise<string> {
  if (reinstall) {
    console.log('  Scope: user (reinstall)');
    return '1';
  }
  if (scopeFlag) {
    const scope = SCOPE_MAP[scopeFlag];
    if (!scope) {
      console.log(`  [fail] Invalid --scope: ${scopeFlag}. Use: user, project, both`);
      closeRL();
      process.exit(1);
    }
    console.log(`  Scope: ${scopeFlag}`);
    return scope;
  }
  if (install || yes) {
    console.log(`  Scope: user (${install ? 'install default' : '--scope omitted, defaulting to user with --yes'})`);
    return '1';
  }
  console.log('\nInstall scope:');
  console.log('  1) User-level (all OMP sessions)');
  console.log('  2) Project-level (this repo only)');
  console.log('  3) Both');
  while (true) {
    const answer = (await ask('\nChoose [1-3] (default 1): ')).trim() || '1';
    if (answer === '1' || answer === '2' || answer === '3') return answer;
    console.log(`  [fail] Invalid scope: ${answer}. Choose 1, 2, or 3.`);
  }
}

async function resolveProfile(): Promise<Profile> {
  const profile = defaultProfile();

  // Single interactive prompt: the Combo preset implies all three modes.
  // Only for a real user at a terminal, only when no default flags were
  // given, and never for --apply-update runs.
  if (tty() && !profileFlagsGiven && !applyUpdate && (install || reinstall)) {
    const comboAnswer = (await ask('  Default Combo preset on session start? [off/medium/balanced/max] (off): ')).trim().toLowerCase();
    if (comboAnswer && COMBO_DEFAULTS.has(comboAnswer)) profile.comboDefault = comboAnswer;
  }

  // Explicit flags always win over the Combo preset.
  if (comboDefaultFlag !== undefined) profile.comboDefault = comboDefaultFlag;
  const preset = COMBO_PRESET_MODES[profile.comboDefault] ?? COMBO_PRESET_MODES.off;
  profile.cavemanDefault = preset.caveman;
  profile.rtkDefault = preset.rtk;
  profile.ponytailDefault = preset.ponytail;
  if (cavemanDefaultFlag !== undefined) profile.cavemanDefault = cavemanDefaultFlag;
  if (rtkDefaultFlag !== undefined) profile.rtkDefault = rtkDefaultFlag === 'on';
  if (ponytailDefaultFlag !== undefined) profile.ponytailDefault = ponytailDefaultFlag;

  console.log(`  Profile: combo default=${profile.comboDefault} (caveman=${profile.cavemanDefault} · rtk=${profile.rtkDefault ? 'on' : 'off'} · ponytail=${profile.ponytailDefault})`);
  return profile;
}

// ponytail: post-install guard. List entries under `extensions: null` break
// OMP launch, so fail loudly here instead of at the next OMP start.
async function validateConfigExtensions(agentDir: string, options: WriteOptions): Promise<void> {
  if (options.dryRun) return;
  const raw = await readTextIfExists(path.join(agentDir, 'config.yml'));
  if (!raw) return;
  const lines = raw.split('\n');
  const keyIdx = lines.findIndex((l) => /^\s*extensions\s*:/i.test(l));
  if (keyIdx === -1) return;
  const scalarNull = /^\s*extensions\s*:\s*(null|~|\[\s*\])\s*$/i.test(lines[keyIdx]);
  const hasEntries = lines.slice(keyIdx + 1).some((l) => /^\s*-\s+\S/.test(l));
  if (scalarNull && hasEntries) {
    console.log('  [fail] config.yml lists extensions under `extensions: null` — OMP will fail to launch.');
    console.log('  [hint] Replace the `extensions: null` line with `extensions:`, then reinstall.');
    process.exitCode = 1;
  } else {
    console.log('  [ok] config.yml extensions key valid');
  }
}

// Persist the profile as omp plugin settings so `omp plugin config get`
// reflects the choice and the extensions pick it up on session start.
async function writePluginSettings(profile: Profile, options: WriteOptions): Promise<void> {
  const pluginsDir = path.join(HOME, '.omp', 'plugins');
  const lockPath = path.join(pluginsDir, 'omp-plugins.lock.json');
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
  settings.ponytailDefault = profile.ponytailDefault;
  config.settings[PACKAGE_NAME] = settings;

  if (options.dryRun) {
    console.log(`  [dry-run] would write plugin settings (${PACKAGE_NAME}) to ${lockPath}`);
    return;
  }
  await fs.mkdir(pluginsDir, { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
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

  if (dryRun) console.log('[dry-run] No changes will be written.\n');

  console.log(`=== Tersio v${PACKAGE_VERSION} ===`);
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Arch: ${process.arch}`);
  console.log(`  Home: ${HOME}`);

  const scope = await resolveScope();


  // Resolve session defaults: flags > interactive prompt > defaults.
  const profile = await resolveProfile();


  const userDir = path.join(HOME, '.omp', 'agent');
  const userExtDir = path.join(userDir, 'extensions');
  const userPluginsDir = path.join(userDir, '..', 'plugins');
  const bunBinDir = path.join(HOME, '.bun', 'bin');
  const projectExtDir = path.join(process.cwd(), '.omp', 'extensions');

  const options: InstallOptions = { dryRun, verbose, yes, scope, reinstall };

  // Check prerequisites
  console.log('\nPrerequisites:');
  try {
    const v = (await execP(IS_WINDOWS ? 'omp.cmd' : 'omp', ['--version'])).stdout.trim();
    console.log(`  [ok] omp ${v}`);
  } catch {
    console.log('  [fail] omp not found — ensure it\'s installed');
  }

  if (scope === '1' || scope === '3') {
    console.log('\n--- User-level install ---');
    await stepSharedSessionState(userExtDir, options);
    await stepPonytail(userPluginsDir, userDir, options);
    const selfPlugin = await stepSelfPlugin(userPluginsDir, options);
    const ponytailExtPath = path.join(userPluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
    await stepRtk(bunBinDir, options);
    await stepRtkSession(userExtDir, options);
    await stepCaveman(userExtDir, options);
    await stepCombo(userExtDir, options);
    await stepModeReinforcement(userExtDir, ponytailExtPath, options);
    await stepUpdater(userExtDir, options);
    if (selfPlugin) await writePluginSettings(profile, options);
    await validateConfigExtensions(userDir, options);
  }

  if (scope === '2' || scope === '3') {
    console.log('\n--- Project-level install ---');
    await stepSharedSessionState(projectExtDir, options);
    await stepRtkSession(projectExtDir, options);
    await stepCaveman(projectExtDir, options);
    await stepUpdater(projectExtDir, options);
    console.log('  [note] Ponytail, RTK binary, and Combo toggle require user-level (global) install');
  }

  console.log('\n=== Installation complete ===');
  console.log('\nNext steps:');
  console.log('  1. Restart OMP');
  console.log('  2. /caveman full');
  console.log('  3. /rtk on');
  console.log('  4. /ponytail full');
  console.log('  5. /ai-addons check');
  console.log('  6. /combo medium   (toggle all 3 at once — off by default)');

  closeRL();
}

main().catch((e) => { closeRL(); console.error(e); process.exitCode = 1; });
