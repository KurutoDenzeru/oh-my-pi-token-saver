## v1.3.4
- Make `/ai-addons update ponytail` use npm directly so OMP installations without Bun can update Ponytail.
- Fix RTK checksum parsing and create its conventional `~/.bun/bin` destination when Bun is absent.
- Add regression coverage for checksum parsing and the npm-based Ponytail update.
- Return `systemPrompt` as an array and append to the existing prompt in the Caveman and RTK session extensions, matching OMP's typed `ExtensionAPI` contract.
- Run `npm test` in CI alongside `npm run check`.

## v1.3.2
- Replace every one-off runner example with cache-safe `npm exec` commands.
- Synchronize README defaults, activation, backup, and checksum guidance with current behavior.

## v1.3.1
- Show the package version in the installer startup header.

## v1.3.0
- Add `update` CLI command that delegates to the latest npm package and reapplies the installer non-interactively.

## v1.2.4
- Restore `execP` promisify fix accidentally dropped in v1.2.3.
- Dry-run now previews Ponytail `defaultMode=off` config before returning.

## v1.2.3
- Set Ponytail default mode to `off` during install so fresh sessions do not show Ponytail by default.
- Keep Ponytail available through `/ponytail` and `/combo`.

## v1.2.2
- Fixed installer child-process handling by promisifying `execFile`.
- Fixed RTK binary discovery for Linux/macOS archives that contain `rtk-*` binary names.
- Added verbose RTK extraction file listing for debugging.

## v1.2.1
- `/combo` now reloads after applying state so modes activate immediately.
- RTK initial install now hard-fails if checksum verification is unavailable or invalid.
- `/ai-addons update rtk` now supports Windows, Linux, and macOS.
- `--dry-run` now includes Ponytail config registration preview.
