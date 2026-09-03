## v1.0.1
- Fix install crash `ERR_USE_AFTER_CLOSE`: the installer closed the shared readline interface after the first prompt, so the second session-default question threw. `ask()` now keeps the interface open; a single close happens at exit. Verified with an interactive pty run through all three prompts.
- Sources now import with `.ts` specifiers (`rewriteRelativeImportExtensions`): compiled output still uses `.js`, package layout unchanged.

## v1.0.0
- Rebrand: `oh-my-pi-token-saver` is now Tersio — npm package `@krtclcdy/tersio`, `tersio` command, OMP plugin, GitHub repo `KurutoDenzeru/tersio`. (Unscoped `tersio` is blocked by npm's typosquat guard against `terser`; the `tersio-omp` stopgap is deprecated.) New product line, so the version restarts at 1.0.0; code is identical to `oh-my-pi-token-saver@2.1.1` apart from the rename.
- Migration is one reinstall: `omp plugin install @krtclcdy/tersio` (or `npm i -g @krtclcdy/tersio` + `tersio install`). The installer drops legacy `oh-my-pi-token-saver` and `tersio-omp` dependencies from `~/.omp/plugins/package.json` on its next run. Old releases stay on npm, deprecated in favor of `@krtclcdy/tersio`.

## v2.1.1
- Fix status bar duplication under the balanced combo preset: caveman and rtk still hardcoded the medium/max preset names in their suppression checks, so `/combo balanced` painted three status lines instead of one. Both extensions now consult `COMBO_LEVELS` from the shared session-state module, so a future preset cannot reopen the gap.

## v2.1.0
- Session-start mode defaults. Set them with the installer (`install --combo-default balanced`, `--caveman-default lite`, `--rtk-default on`, or the interactive prompt) or through OMP plugin settings (`omp plugin config set oh-my-pi-token-saver comboDefault max`). All default off.
- Declares `omp.settings` (typed enum/boolean settings) in `package.json` so the same knobs are manageable from OMP's plugin manager without the installer.
- Defaults persist to `~/.omp/plugins/omp-plugins.lock.json`; extensions read them via the new `extensions/shared/plugin-settings.js` (shipped by the installer).
- Persisted session state always wins: `/combo`, `/caveman`, and `/rtk` entries override the defaults on every restore.
- Installer drops its own add-on selection; per-add-on choice is OMP's native feature-flag job (`omp plugin install 'oh-my-pi-token-saver[caveman,ponytail]'`, `omp plugin features --disable rtk`).

## v2.0.0
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
