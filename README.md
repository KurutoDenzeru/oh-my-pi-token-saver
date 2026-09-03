# oh-my-pi-token-saver

> Maintained fork of the unmaintained [Fernado03/oh-my-pi-supreme-token-saver](https://github.com/Fernado03/oh-my-pi-supreme-token-saver). Original author: Fernado03.

A passive Amanai reward detector plus three toggleable [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) add-ons for terse replies, compact shell output, and minimal code decisions. It also includes combined toggles, health checks, updates, and dry-run support.

## Install

### OMP users: plugin install (recommended)

If you use OMP, install the package as a managed plugin — no separate installer run, and OMP's plugin manager handles updates, enable/disable, and per-add-on features:

```bash
omp plugin install oh-my-pi-token-saver
```

Then start a new OMP session. Every add-on is on by default; trim the set with OMP's feature flags:

```bash
omp plugin install 'oh-my-pi-token-saver[caveman,ponytail]'   # only these two add-ons
omp plugin features oh-my-pi-token-saver --disable rtk        # turn one off later
```

Features: `caveman`, `rtk`, `ponytail` (combo bar + mode reinforcement), `updater` (`/ai-addons`). The Amanai reward detector is the plugin base and is always loaded.

### Installer (npm CLI)

```bash
npm install -g oh-my-pi-token-saver@latest
oh-my-pi-token-saver install
```

The first command installs the CLI globally with npm; the second installs its add-ons into your OMP home, so both are required. At a terminal, `install` asks for optional session-start defaults; every prompt keeps its default on Enter. Non-interactive runs keep the classic behavior (all add-ons, modes off).

Default flags (also usable non-interactively):

```bash
oh-my-pi-token-saver install --combo-default balanced   # session-start Combo preset
oh-my-pi-token-saver install --caveman-default lite --rtk-default on
```

Defaults apply only to fresh sessions — anything you persist with `/combo`, `/caveman`, or `/rtk` always wins. They are stored as plugin settings (`omp plugin config get oh-my-pi-token-saver comboDefault`) and can be changed later with `omp plugin config set`.

**After install:** restart OMP, then enable a preset:

```text
/combo medium
```

Individual toggles: `/caveman full` · `/rtk on` · `/ponytail full`

### Headroom

[Headroom](https://github.com/headroomlabs-ai/headroom) is a local-first compression proxy that shrinks tool outputs, JSON, and logs before they reach the model — a different layer from this package's prompt-level add-ons, and the two stack. The installer checks for it on every install and offers to enable routing; from inside OMP it is managed like the other add-ons (see `/headroom` and `/ai-addons` in Commands reference). While wrapped, the combo status bar shows `🗜️headroom=ON`.

## What it installs

| Add-on | What it does |
|---|---|
| **Caveman** | Shortens replies while retaining technical substance. Modes: `lite`, `full`, `ultra`, and `wenyan` |
| **RTK** | Routes noisy shell commands through the RTK binary for compact output |
| **Ponytail** | Favors standard-library, minimal, YAGNI-oriented code decisions |
| **Updater** | Checks and updates Ponytail, RTK, and Caveman in-session, with dry-run and backup support |
| **Combo** | Switches Caveman, RTK, and Ponytail together. Presets: `off`, `medium`, `balanced`, and `max`; mixed individual modes display as `custom` |
| **Amanai reward detector** | Locally notifies you when a final successful response contains a footer-shaped `AMANAI-GACHA-…` key; it never changes output, stores or sends the key, redeems it, opens a browser, or creates requests |

User-level installs also register the package in `~/.omp/plugins`, so it appears as `oh-my-pi-token-saver` in OMP **Settings → Plugins**. In that state the Amanai reward detector loads through the plugin manifest instead of a copied extension entry.

All three token-saving modes start off until you enable them.

For long sessions, the package reasserts active modes after Ponytail's prompt block on every top-level turn, including after OMP compacts earlier history.

### Amanai reward detector

The detector only scans the completed final assistant response, then shows a local notice. Redeem any detected key yourself in the Amanai billing dashboard; the extension does not retain or expose it.

The package also declares a Pi-native adapter through `pi.extensions`. It waits for Pi's final settled response before issuing the same local notice; the OMP installer installs only the OMP adapter.

## CLI

After the global install, use these short commands for routine maintenance:

| Command | Purpose |
|---|---|
| `oh-my-pi-token-saver install` | Install non-interactively to user scope by default; use `--scope project` or `--scope both` for another scope |
| `oh-my-pi-token-saver update` | Fetch the latest release and refresh the user installation |
| `oh-my-pi-token-saver reinstall` | Remove the bundled extension directories and RTK binary, then install fresh at user scope; the separate Ponytail package is preserved and refreshed |
| `oh-my-pi-token-saver doctor` | Check OMP, extension, Ponytail, RTK, and Headroom routing health |
| `oh-my-pi-token-saver uninstall` | Remove bundled extensions, the legacy `aaa-combo-boot` helper, and the plugin registration; add `--remove-rtk` to remove the RTK binary, `--remove-ponytail` to unregister Ponytail's extension path (the Ponytail package remains installed), or `--remove-headroom` to undo the Headroom wrap |
| `oh-my-pi-token-saver version` | Print the package version (`--version` or `-v` also works) |
Useful flags are `--scope user|project|both`, `--combo-default`/`--caveman-default`/`--rtk-default` (session-start defaults), `--dry-run`, `--yes`/`-y`, and `--verbose`. The original no-subcommand install and legacy `--doctor` and `--uninstall` forms remain supported.


## Commands reference

### Caveman — terse replies

```text
/caveman lite         concise, drops pleasantries
/caveman full         terse caveman style
/caveman ultra        maximum terse, fragments only
/caveman wenyan       classical-Chinese-style where clear
/caveman off          normal mode
/caveman status       show current mode
```

Natural-language off switches also work: `caveman off`, `stop caveman`, and `normal mode`.

### RTK — compact shell output

```text
/rtk on               enable compact RTK output
/rtk off              disable
/rtk status           show current state
```

When enabled, the agent prefers RTK for noisy commands such as:

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
/ponytail full        full YAGNI enforcement
/ponytail ultra       aggressive simplification
/ponytail off         disable
/ponytail status      show current state
```

### Updater — check and update add-ons

```text
/ai-addons check                          check all add-on versions
/ai-addons status                         same as check
/ai-addons update ponytail                update Ponytail
/ai-addons update rtk                     update the RTK binary
/ai-addons update caveman                 update the Caveman rule
/ai-addons update headroom                update Headroom (`headroom update`)
/ai-addons update all                     update all four
/ai-addons update all --dry-run           preview without changes
```

### Combo — toggle all three

```text
/combo off            all three off (default)
/combo medium         caveman=lite, rtk=on, ponytail=lite
/combo balanced       caveman=full, rtk=on, ponytail=full
/combo max            caveman=ultra, rtk=on, ponytail=ultra
/combo status         show the level and underlying modes
/combo help           show available levels
```

`/combo` persists each add-on's state and reloads OMP so the new modes apply immediately, without emitting separate `/caveman`, `/rtk`, or `/ponytail` command messages.

Active Combo presets are inherited by OMP task subagents created from the session. `/combo medium`, `/combo balanced`, or `/combo max` is the only way to activate a preset and show the Combo footer indicator. Individual `/caveman`, `/rtk`, and `/ponytail` commands leave Combo inactive; `/combo status` reports their actual mixed state without turning the indicator on.

### Headroom — compression routing

```text
/headroom on           route OMP through the proxy (reversible override)
/headroom off          restore models.yml from backup
/headroom status       CLI version, wrap state, proxy health
```

In-session `/headroom on` uses the non-launching prepare path; start the proxy separately if needed (`headroom proxy --port 8787`). From a shell, plain `headroom wrap omp` additionally starts the proxy and launches OMP through it.

## File locations

| What | Path |
|---|---|
| Caveman extension | `~/.omp/agent/extensions/caveman-session/` |
| RTK extension | `~/.omp/agent/extensions/rtk-session/` |
| Ponytail package | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` |
| Updater extension | `~/.omp/agent/extensions/ai-addons-updater/` |
| Combo extension | `~/.omp/agent/extensions/combo-toggle/` |
| Amanai detector extension | `~/.omp/agent/extensions/amanai-reward/` |
| RTK binary | `~/.bun/bin/rtk` (`rtk.exe` on Windows) |
| Explicit extension registrations | `~/.omp/agent/config.yml` |

## Backups

Before replacing an existing extension source file, the installer writes `<file>.bak`. The in-session updater also creates:

- RTK binary: `rtk.bak` or `rtk.exe.bak`, restored if the new binary fails validation
- Caveman rule: `rule.md.bak`, restored if the written hash is invalid

## Development

Source lives in TypeScript: `install-omp-addons.ts`, `extensions/**/*.ts`, shared helpers in `extensions/lib/utils.ts`, and OMP host types in `extensions/shared/types.ts`. Tests run directly on the TypeScript source through `tsx` — Node never executes a `.ts` file.

The `.js` files sitting next to the sources are compiled build artifacts, not hand-written code: `npm run build` emits them, they are gitignored, and npm publishes them. Runtime consumers (`bin`, the OMP plugin manifest, the installed extensions) all point at the compiled `.js`.

```bash
npm run check   # type-check only (tsc --noEmit)
npm run build   # compile .ts → .js
npm test        # run tests on the TypeScript source via tsx
npm run clean   # remove compiled .js artifacts
```

If `git status` looks clean but stray `.js` files confuse an editor's global search, run `npm run clean` and rebuild.

## Prerequisites

- [OMP (Oh My Pi)](https://github.com/can1357/oh-my-pi)
- Node.js 18+ with npm

The installer and `/ai-addons update all` create `~/.bun/bin` for RTK compatibility even when Bun is not installed.

### WSL

Windows and WSL have separate OMP homes. When installing for OMP inside WSL, run the install from WSL and check:

```bash
command -v npm
```

It must resolve to a Linux path such as `~/.nvm/versions/node/.../bin/npm`, not a Windows path under `/mnt/c/`; otherwise the add-ons may be installed into the Windows environment instead of the WSL OMP home.

## Advanced: one-off use

Without keeping the package globally installed, run the latest release once:

```bash
npm exec --yes --prefer-online --package=oh-my-pi-token-saver@latest -- oh-my-pi-token-saver install
```

## Troubleshooting

### Ponytail or Combo command is missing

Run `oh-my-pi-token-saver reinstall` in the same Windows, WSL, or Linux environment where OMP runs, restart OMP, then try `/ponytail status` and `/combo status`. If either is still missing, run `oh-my-pi-token-saver doctor`; the installer normally repairs both explicit registrations in `~/.omp/agent/config.yml`.

### RTK is missing or not executable

Run `oh-my-pi-token-saver reinstall`, then `oh-my-pi-token-saver doctor`. On Linux or macOS, an older manually installed binary can be repaired with:

```bash
chmod +x ~/.bun/bin/rtk
```

### Checksum warning or failure

The installer verifies RTK against `checksums.txt` when checksum metadata is available and aborts on a mismatch. If the checksum file or matching asset entry is unavailable, installation warns and continues; `/ai-addons update rtk` is stricter and aborts when checksum metadata is missing.

## License

MIT
