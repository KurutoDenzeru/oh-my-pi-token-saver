# oh-my-pi-supreme-token-saver

Three toggleable OMP extensions that save tokens: terse replies, compact shell output, and minimal code decisions — with a manual updater and dry-run support.

## Install

### Option 1: npx (recommended)

```bash
npx @fernado03/oh-my-pi-supreme-token-saver
```

### Option 2: npm install global

```bash
npm install -g @fernado03/oh-my-pi-supreme-token-saver
oh-my-pi-supreme-token-saver
```

### Option 3: clone and run

```bash
git clone https://github.com/Fernado03/oh-my-pi-supreme-token-saver.git
cd oh-my-pi-supreme-token-saver
node install-omp-addons.js
```

### Update (re-run to overwrite old versions)

```bash
npx @fernado03/oh-my-pi-supreme-token-saver
```

Or if installed globally:

```bash
oh-my-pi-supreme-token-saver
```

Re-running the installer overwrites old extension files and fetches the latest versions. Backups of the previous files are created automatically (`.bak` suffix).

For in-session updates without re-running the installer:

```text
/ai-addons update all
```

Dry run first to see what would change:

```text
/ai-addons update all --dry-run
```

## CLI Flags

```bash
# Non-interactive install (user scope, no prompts)
npx @fernado03/oh-my-pi-supreme-token-saver --scope user --yes

# Project-level install
npx @fernado03/oh-my-pi-supreme-token-saver --scope project --yes

# Both user and project
npx @fernado03/oh-my-pi-supreme-token-saver --scope both --yes

# Dry run — shows planned changes without writing
npx @fernado03/oh-my-pi-supreme-token-saver --dry-run --scope user --yes

# Doctor — check installation health
npx @fernado03/oh-my-pi-supreme-token-saver --doctor

# Uninstall — removes installed extensions (prompts for confirmation)
npx @fernado03/oh-my-pi-supreme-token-saver --uninstall

# Uninstall without prompt
npx @fernado03/oh-my-pi-supreme-token-saver --uninstall --yes

# Verbose output (debug details)
npx @fernado03/oh-my-pi-supreme-token-saver --verbose
```

### Scope options

| Flag | Meaning |
|------|---------|
| `--scope user` | User-level (all OMP sessions) — recommended |
| `--scope project` | Project-level (this repo only) |
| `--scope both` | Both user and project |

### Dry run

```bash
npx @fernado03/oh-my-pi-supreme-token-saver --dry-run
```

## What it installs

| Extension | Command | What it does |
|---|---|---|
| **Caveman** | `/caveman full` | Shorter replies. Drops filler, keeps technical substance. Modes: `lite`, `full`, `ultra`, `wenyan` |
| **RTK** | `/rtk on` | Compact shell output. Routes `git status`, `git diff`, `test` through RTK binary |
| **Ponytail** | `/ponytail full` | Minimal code decisions. Prefers stdlib, avoids over-engineering |
| **Updater** | `/ai-addons check` | Manual update command with dry-run support. Backs up before replacing |
| **Combo** | `/combo medium` | Toggle all 3 at once. Levels: `off`, `medium`, `max`. Off by default |

## After install

Restart OMP, then:

```text
/caveman full
/rtk on
/ponytail full
/ai-addons check
/combo medium
```

By default, this installer sets Ponytail's default mode to `off` so fresh OMP sessions start clean. Use `/combo medium`, `/combo max`, or `/ponytail full` to enable it per session.

## Commands reference

### Caveman — terse replies

```text
/caveman lite         concise, drops pleasantries
/caveman full         terse caveman style (default)
/caveman ultra        maximum terse, fragments only
/caveman wenyan       classical-Chinese-style where clear
/caveman off          normal mode
/caveman status       show current mode
```

Natural language also works:

```text
"caveman full"
"stop caveman"
"normal mode"
```

### RTK — compact shell output

```text
/rtk on               enable RTK compact output
/rtk off              disable
/rtk status           show current state
```

When enabled, the agent prefers `rtk` for noisy commands:

```text
rtk git status
rtk git diff
rtk read src/index.ts
rtk grep "pattern" src
rtk test bun test
rtk tsc
rtk lint
```

### Ponytail — minimal code

```text
/ponytail lite        light guidance
/ponytail full        full YAGNI enforcement (default)
/ponytail ultra       aggressive simplification
/ponytail off         disable
/ponytail status      show current state
```

### Updater — check and update add-ons

```text
/ai-addons check                          check all add-on versions
/ai-addons status                         same as check
/ai-addons update ponytail                update ponytail
/ai-addons update rtk                     update rtk binary
/ai-addons update caveman                 update caveman rule
/ai-addons update all                     update all three
/ai-addons update all --dry-run           dry run, no changes
```

### Combo — toggle all 3 at once

```text
/combo off            all three off (default)
/combo medium         caveman=lite, rtk=on, ponytail=lite
/combo max            caveman=ultra, rtk=on, ponytail=ultra
/combo status         show current level and underlying modes
/combo help           show available levels
```

**Fixed in v1.2.0:** `/combo` no longer sends visible `/caveman`, `/rtk`, `/ponytail` messages. It persists state directly and shows its own status indicator.

## File locations

| What | Path |
|---|---|
| Caveman extension | `~/.omp/agent/extensions/caveman-session/` |
| RTK extension | `~/.omp/agent/extensions/rtk-session/index.js` |
| Ponytail | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` |
| Updater | `~/.omp/agent/extensions/ai-addons-updater/index.js` |
| Combo toggle | `~/.omp/agent/extensions/combo-toggle/index.js` |

## Backup behavior

All updates back up before replacing:

- RTK binary → `rtk.exe.bak` (restored if `--version` check fails)
- Caveman `rule.md` → `rule.md.bak` (restored if hash mismatch)

## Manual install (without the script)

### Caveman

Copy `extensions/caveman-session/` to `~/.omp/agent/extensions/caveman-session/`

### RTK

1. Copy `extensions/rtk-session/index.js` to `~/.omp/agent/extensions/rtk-session/index.js`
2. Download RTK binary from [github.com/rtk-ai/rtk/releases](https://github.com/rtk-ai/rtk/releases)
3. Place at `~/.bun/bin/rtk.exe` (Windows) or `~/.bun/bin/rtk` (Unix)

### Ponytail

```bash
cd ~/.omp/plugins
omp plugin install github:DietrichGebert/ponytail
```

### Updater

Copy `extensions/ai-addons-updater/` to `~/.omp/agent/extensions/ai-addons-updater/`

### Combo toggle

Copy `extensions/combo-toggle/` to `~/.omp/agent/extensions/combo-toggle/`

## Prerequisites

- [OMP (Oh My Pi)](https://github.com/oh-my-pi/pi) installed
- [Bun](https://bun.sh) installed (for RTK binary path)
- Node.js 18+

## Troubleshooting

### /ponytail command not found (skill loads but command missing)

Ponytail's extension module may not be discovered by OMP on some setups. The install script handles this automatically by adding the extension path to `config.yml`, but if you installed manually:

Add this to `~/.omp/agent/config.yml`:

```yaml
extensions:
  - ~/.omp/plugins/node_modules/@dietrichgebert/ponytail/pi-extension/index.js
```

Then restart OMP. Verify with:

```text
/ponytail status
```

### /combo command not found

The installer auto-registers Combo in `config.yml`. If it still doesn't load:

```yaml
extensions:
  - ~/.omp/agent/extensions/combo-toggle/index.js
```

Then restart OMP. Verify with:

```text
/combo status
```

### Combo status indicator not showing

Run these to diagnose:

```text
/caveman status
/rtk status
/ponytail status
/combo status
```

Or run the installer doctor:

```bash
npx @fernado03/oh-my-pi-supreme-token-saver --doctor
```

### RTK not executable on Linux/macOS

The installer now sets `chmod +x` automatically. If manually installed:

```bash
chmod +x ~/.bun/bin/rtk
```

### Checksum verification failed

The installer downloads and verifies RTK against `checksums.txt` from the GitHub release. If verification fails, it aborts safely — no binary is installed.


MIT
