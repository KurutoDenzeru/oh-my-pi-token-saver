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

You'll be asked to choose an install scope:

1. **User-level** — applies to all OMP sessions (recommended)
2. **Project-level** — applies to this repo only
3. **Both**

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

## After install

Restart OMP, then:

```text
/caveman full
/rtk on
/ponytail full
/ai-addons check
```

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

## File locations

| What | Path |
|---|---|
| Caveman extension | `~/.omp/agent/extensions/caveman-session/` |
| RTK extension | `~/.omp/agent/extensions/rtk-session/index.js` |
| Ponytail | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` |
| RTK binary | `~/.bun/bin/rtk.exe` (Win) / `~/.bun/bin/rtk` (Unix) |
| Updater | `~/.omp/agent/extensions/ai-addons-updater/index.js` |

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

## Prerequisites

- [OMP (Oh My Pi)](https://github.com/oh-my-pi/pi) installed
- [Bun](https://bun.sh) installed (for RTK binary path)
- Node.js 18+

## License

MIT
