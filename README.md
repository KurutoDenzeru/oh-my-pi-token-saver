# oh-my-pi-supreme-token-saver

Three toggleable [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) add-ons that save tokens: terse replies, compact shell output, and minimal code decisions. It also includes combined toggles, health checks, updates, and dry-run support.

## Install

```bash
npm install -g @fernado03/oh-my-pi-supreme-token-saver@latest
oh-my-pi-supreme-token-saver install
```

The first command installs the CLI globally with npm; the second installs its add-ons into your OMP home, so both are required.

**After install:** restart OMP, then enable the balanced preset:

```text
/combo medium
```

Individual toggles: `/caveman full` · `/rtk on` · `/ponytail full`

## What it installs

| Add-on | What it does |
|---|---|
| **Caveman** | Shortens replies while retaining technical substance. Modes: `lite`, `full`, `ultra`, and `wenyan` |
| **RTK** | Routes noisy shell commands through the RTK binary for compact output |
| **Ponytail** | Favors standard-library, minimal, YAGNI-oriented code decisions |
| **Updater** | Checks and updates Ponytail, RTK, and Caveman in-session, with dry-run and backup support |
| **Combo** | Switches Caveman, RTK, and Ponytail together. Levels: `off`, `medium`, and `max` |

All three token-saving modes start off until you enable them.

## CLI

After the global install, use these short commands for routine maintenance:

| Command | Purpose |
|---|---|
| `oh-my-pi-supreme-token-saver install` | Install non-interactively to user scope by default; use `--scope project` or `--scope both` for another scope |
| `oh-my-pi-supreme-token-saver update` | Fetch the latest release and refresh the user installation |
| `oh-my-pi-supreme-token-saver reinstall` | Remove the four bundled extension directories and RTK binary, then install fresh at user scope; the separate Ponytail package is preserved and refreshed |
| `oh-my-pi-supreme-token-saver doctor` | Check OMP, extension, Ponytail, and RTK installation health |
| `oh-my-pi-supreme-token-saver uninstall` | Remove bundled extensions; add `--remove-rtk` to remove the RTK binary or `--remove-ponytail` to unregister Ponytail's extension path (the Ponytail package remains installed) |
| `oh-my-pi-supreme-token-saver version` | Print the package version (`--version` or `-v` also works) |
| `oh-my-pi-supreme-token-saver help` | Show usage (`--help` or `-h` also works) |

Useful flags are `--scope user|project|both`, `--dry-run`, `--yes`/`-y`, and `--verbose`. The original no-subcommand install and legacy `--doctor` and `--uninstall` forms remain supported.

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
/ai-addons update all                     update all three
/ai-addons update all --dry-run           preview without changes
```

### Combo — toggle all three

```text
/combo off            all three off (default)
/combo medium         caveman=lite, rtk=on, ponytail=lite
/combo max            caveman=ultra, rtk=on, ponytail=ultra
/combo status         show the level and underlying modes
/combo help           show available levels
```

`/combo` persists each add-on's state and reloads OMP so the new modes apply immediately, without emitting separate `/caveman`, `/rtk`, or `/ponytail` command messages.

## File locations

| What | Path |
|---|---|
| Caveman extension | `~/.omp/agent/extensions/caveman-session/` |
| RTK extension | `~/.omp/agent/extensions/rtk-session/` |
| Ponytail package | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` |
| Updater extension | `~/.omp/agent/extensions/ai-addons-updater/` |
| Combo extension | `~/.omp/agent/extensions/combo-toggle/` |
| RTK binary | `~/.bun/bin/rtk` (`rtk.exe` on Windows) |
| Explicit extension registrations | `~/.omp/agent/config.yml` |

## Backups

Before replacing an existing extension source file, the installer writes `<file>.bak`. The in-session updater also creates:

- RTK binary: `rtk.bak` or `rtk.exe.bak`, restored if the new binary fails validation
- Caveman rule: `rule.md.bak`, restored if the written hash is invalid

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
npm exec --yes --prefer-online --package=@fernado03/oh-my-pi-supreme-token-saver@latest -- oh-my-pi-supreme-token-saver install
```

## Troubleshooting

### Ponytail or Combo command is missing

Run `oh-my-pi-supreme-token-saver reinstall` in the same Windows, WSL, or Linux environment where OMP runs, restart OMP, then try `/ponytail status` and `/combo status`. If either is still missing, run `oh-my-pi-supreme-token-saver doctor`; the installer normally repairs both explicit registrations in `~/.omp/agent/config.yml`.

### RTK is missing or not executable

Run `oh-my-pi-supreme-token-saver reinstall`, then `oh-my-pi-supreme-token-saver doctor`. On Linux or macOS, an older manually installed binary can be repaired with:

```bash
chmod +x ~/.bun/bin/rtk
```

### Checksum warning or failure

The installer verifies RTK against `checksums.txt` when checksum metadata is available and aborts on a mismatch. If the checksum file or matching asset entry is unavailable, installation warns and continues; `/ai-addons update rtk` is stricter and aborts when checksum metadata is missing.

## License

MIT
