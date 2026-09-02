# oh-my-pi-supreme-token-saver

Three OMP extensions that save tokens, give you shorter replies, and keep your code minimal.

```
oh-my-pi-supreme-token-saver/
├── install-omp-addons.js    ← run this once
├── README.md
├── extensions/
│   ├── caveman-session/     ← /caveman toggle
│   │   ├── index.js
│   │   └── rule.md
│   ├── rtk-session/         ← /rtk toggle
│   │   └── index.js
│   └── ai-addons-updater/   ← /ai-addons updater
│       └── index.js
```

## What it installs

| Extension | Command | What it does |
|---|---|---|
| **Caveman** | `/caveman full` | Shorter replies. Drops filler, keeps technical substance. Modes: `lite`, `full`, `ultra`, `wenyan` |
| **RTK** | `/rtk on` | Compact shell output. Routes `git status`, `git diff`, `test` through RTK binary |
| **Ponytail** | `/ponytail full` | Minimal code decisions. Prefers stdlib, avoids over-engineering |
| **Updater** | `/ai-addons check` | Manual update command with dry-run support. Backs up before replacing |

## Quick install

```bash
# Clone this repo
git clone https://github.com/YOUR-USERNAME/oh-my-pi-supreme-token-saver.git
cd oh-my-pi-supreme-token-saver

# Run the installer
node install-omp-addons.js
```

You'll be asked to choose:
1. **User-level** — applies to all OMP sessions (recommended)
2. **Project-level** — applies to this repo only
3. **Both**

After install, restart OMP:

```text
/caveman full
/rtk on
/ponytail full
/ai-addons check
```

## Manual install (without the script)

### Caveman
Copy `extensions/caveman-session/` to `~/.omp/agent/extensions/caveman-session/`

### RTK
1. Copy `extensions/rtk-session/index.js` to `~/.omp/agent/extensions/rtk-session/index.js`
2. Download RTK binary from [github.com/rtk-ai/rtk/releases](https://github.com/rtk-ai/rtk/releases)
3. Place it at `~/.bun/bin/rtk.exe` (Windows) or `~/.bun/bin/rtk` (Unix)

### Ponytail
```bash
cd ~/.omp/plugins
omp plugin install github:DietrichGebert/ponytail
```

### Updater
Copy `extensions/ai-addons-updater/` to `~/.omp/agent/extensions/ai-addons-updater/`

## File locations

| What | Path |
|---|---|
| Caveman rule.md | `~/.omp/agent/extensions/caveman-session/rule.md` |
| RTK session | `~/.omp/agent/extensions/rtk-session/index.js` |
| Ponytail | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` |
| RTK binary | `~/.bun/bin/rtk.exe` (Win) / `~/.bun/bin/rtk` (Unix) |
| Updater | `~/.omp/agent/extensions/ai-addons-updater/index.js` |

## Backup behavior

All three extensions back up before replacing files:
- RTK binary → `rtk.exe.bak` (or `rtk.bak`)
- Caveman rule.md → `rule.md.bak`
- RTK binary restored automatically if new binary fails `--version` check

## License

MIT
