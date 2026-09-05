# Tersio ✂️

[![npm version](https://img.shields.io/npm/v/@krtclcdy%2Ftersio?color=cb0000)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![release](https://img.shields.io/github/v/release/KurutoDenzeru/tersio?color=7c3aed)](https://github.com/KurutoDenzeru/tersio/releases)
[![license](https://img.shields.io/badge/license-MIT-6e7681)](./LICENSE)
[![node](https://img.shields.io/node/v/@krtclcdy%2Ftersio?color=30363d)](https://nodejs.org)
[![CI](https://github.com/KurutoDenzeru/tersio/actions/workflows/ci.yml/badge.svg)](https://github.com/KurutoDenzeru/tersio/actions)
[![issues](https://img.shields.io/github/issues/KurutoDenzeru/tersio?color=d97706)](https://github.com/KurutoDenzeru/tersio/issues)

Terse replies, compact shell output, and minimal code decisions for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi).

## Install

OMP plugin (recommended — updates and feature flags handled by OMP):

```bash
omp plugin install @krtclcdy/tersio
```

Subset only:

```bash
omp plugin install '@krtclcdy/tersio[caveman,ponytail]'
omp plugin features @krtclcdy/tersio --disable rtk
```

npm CLI (installs add-ons into your OMP home):

```bash
npm install -g @krtclcdy/tersio@latest
tersio install
```

Then restart OMP and enable a preset:

```text
/combo medium
```

Individual toggles: `/caveman full` · `/rtk on` · `/ponytail full`. Everything starts off until you enable it.

Session-start defaults (prompted during `install`, or flags):

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

Defaults apply to fresh sessions only — anything persisted with `/combo`, `/caveman`, or `/rtk` wins. Stored as plugin settings (`omp plugin config get @krtclcdy/tersio comboDefault`).

## What it installs

| Add-on | What it does |
|---|---|
| **Caveman** | Shortens replies, keeps technical substance. Modes: `lite`, `full`, `ultra`, `wenyan` |
| **RTK** | Routes noisy shell commands through the RTK binary for compact output |
| **Ponytail** | Minimal, YAGNI-oriented code decisions |
| **Combo** | Toggles all three at once. Presets: `off`, `medium`, `balanced`, `max` |
| **Updater** | `/ai-addons` checks and updates Ponytail, RTK, and Caveman in-session, with dry-run and backups |

User-level installs also register the package in `~/.omp/plugins` (visible in OMP **Settings → Plugins**), directly through the plugin manifest. Active modes reassert after Ponytail's prompt block on every top-level turn, including after history compaction.

## Benchmarks

Measured before/after — real `o200k_base` token counts, samples and run protocol in [BENCHMARK.md](./BENCHMARK.md). Overhead is paid once per session; savings accumulate per reply, command, or task.

| Mode | Overhead (once) | Before | After | Saving | Pays off after |
|---|---:|---:|---:|---:|---|
| `/caveman lite` | 46 tok | 146 tok/reply | 67 | −55% | 1 reply |
| `/caveman full` | 172 tok | 146 tok/reply | 61 | −58% | ~2 replies |
| `/caveman ultra` | 68 tok | 146 tok/reply | 34 | −77% | 1 reply |
| `/rtk on` | 165 tok | 537 tok (grep) | 469 | −13% (−34% on `git status`) | varies |
| `/ponytail full` | 76 tok | 261–481 tok/task | 108–143 | −59 to −70% | first task |
| `/combo balanced` | 480 tok | 944 tok mixed turn | 638 | −32%/turn | first turn |

## CLI

| Command | Purpose |
|---|---|
| `tersio install` | Install (user scope by default; `--scope project\|both` for more) |
| `tersio update` | Refresh from the latest release |
| `tersio reinstall` | Fresh install, preserving the Ponytail package |
| `tersio doctor` | Check OMP, extension, Ponytail, and RTK health |
| `tersio uninstall` | Remove extensions and registration (`--remove-rtk`, `--remove-ponytail` for more) |
| `tersio version` | Print version |

Flags: `--dry-run`, `--yes`/`-y`, `--verbose`, `--scope`, `--combo-default`/`--caveman-default`/`--rtk-default`/`--ponytail-default`. Legacy `--doctor` / `--uninstall` forms still work.

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

`caveman off`, `stop caveman`, and `normal mode` also work.

### RTK — compact shell output

```text
/rtk on               enable compact RTK output
/rtk off              disable
/rtk status           show current state
```

Covers noisy commands (`git status`, `git diff`, `read`, `grep`, test, `tsc`, lint).

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
/combo balanced       caveman=full, rtk=on, ponytail=full
/combo max            caveman=ultra, rtk=on, ponytail=ultra
/combo status         show the level and underlying modes
/combo help           show available levels
```

`/combo` persists state and reloads OMP without emitting separate command messages. Presets propagate to task subagents and light the Combo footer indicator; individual commands leave Combo inactive (`/combo status` still reports the mixed state).

## Files and backups

| What | Path |
|---|---|
| Caveman / RTK / Updater / Combo extensions | `~/.omp/agent/extensions/{caveman-session,rtk-session,ai-addons-updater,combo-toggle}/` |
| Ponytail package | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` |
| RTK binary | `~/.bun/bin/rtk` (`rtk.exe` on Windows) |
| Extension registrations | `~/.omp/agent/config.yml` |

The installer writes `<file>.bak` before replacing an extension source; the updater keeps `rtk.bak` / `rule.md.bak` and restores them if the replacement fails validation.

## Requirements

- [OMP](https://github.com/can1357/oh-my-pi)
- Node.js 18+ with npm

Windows/WSL have separate OMP homes — install from the environment where OMP runs. Inside WSL, `command -v npm` must resolve to a Linux path, not `/mnt/c/`.

One-off use without installing:

```bash
npm exec --yes --prefer-online --package=@krtclcdy/tersio@latest -- tersio install
```

## Troubleshooting

**Ponytail or Combo command missing:** run `tersio reinstall` in OMP's environment, restart OMP, then `tersio doctor` (repairs `config.yml` registrations).

**RTK missing or not executable:** run `tersio reinstall`, then `tersio doctor`. On Linux/macOS: `chmod +x ~/.bun/bin/rtk`.

**Checksum warning or failure:** the installer aborts on RTK checksum mismatch but warns and continues when checksum metadata is unavailable; `/ai-addons update rtk` aborts when metadata is missing.

## License

[MIT](./LICENSE)
