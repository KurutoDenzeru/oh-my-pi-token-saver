## Unreleased
- Full TypeScript migration: all 9 source files and 7 test files converted to TypeScript (`strict` mode, NodeNext resolution). `npm run build` compiles to `.js` (published), `npm run check` type-checks, tests run via `tsx`.
- Extracted duplicated helpers (`httpsGet`, `httpsDownload`, `sha256Hex`, `parseChecksum`, `readTextIfExists`, `normalizeRtkVersion`) from the installer and `/ai-addons` updater into `extensions/lib/utils.ts`.
- Added shared extension-host types (`extensions/shared/types.ts`); typed all extension entry points, installer functions, and test fakes.
- Installer now ships the compiled `shared/types.js` and `lib/utils.js` alongside the extensions they import.

## v1.2.0
- New Combo preset `balanced`: caveman=full, rtk=on, ponytail=full — sits between `medium` (lite) and `max` (ultra). `/combo balanced` activates it, shows the footer bar, and inherits into task subagents like the other presets.

## v1.1.3
- Combo bar now includes the active level: `🧩 combo MEDIUM: 🪨caveman=LITE ⚡rtk=ON 🦥ponytail=LITE` (or `MAX`).
- Combo clobbers the sibling `caveman`, `rtk`, and `ponytail` status slots after painting its own, so a stale `🪨 caveman: LITE` line no longer lingers alongside the combo bar.

## v1.1.2
- Status bar shows a single unified line for combo presets: `🧩 combo: 🪨caveman=LITE ⚡rtk=ON 🦥ponytail=LITE`; individual `caveman` and `rtk` bars stay clear while a preset is active.
- Installer writes `~/.config/ponytail/config.json#hideStatus=true` so the upstream ponytail bar (horse + level icon) is suppressed; combo owns the bar. Per-level ponytail icons remain `🌿 / ⚡ / 🔥` inside the system-prompt block.

## v1.1.0
- Register `oh-my-pi-token-saver` in `~/.omp/plugins` during user-level install so the package appears in OMP Settings → Plugins; when registered, the Amanai reward detector loads through the plugin manifest instead of a copied `agent/extensions` entry (no double load).
- `uninstall` now also removes the legacy `aaa-combo-boot` helper (it imports `shared/session-state.js` and failed to load after uninstall) and drops the package's plugin registration from `~/.omp/plugins`.
- `doctor` reports the self-plugin registration and recognizes the plugin-provided Amanai detector.

## v1.0.0
- Initial release of the maintained fork of [Fernado03/oh-my-pi-supreme-token-saver](https://github.com/Fernado03/oh-my-pi-supreme-token-saver) (unmaintained upstream, releases v1.2.1–v1.3.10).
- Published to npm as `oh-my-pi-token-saver`; the CLI command is now `oh-my-pi-token-saver`.
- Carries over upstream behavior: Caveman, RTK, and Ponytail session modes; Combo presets; `/ai-addons` updater with dry-run; passive Amanai reward detector; installer subcommands (`install`, `update`, `reinstall`, `doctor`, `uninstall`, `version`, `help`) with `--scope`, `--dry-run`, `--yes`, and `--verbose`.
