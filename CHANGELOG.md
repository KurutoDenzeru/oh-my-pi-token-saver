## v1.2.2
- Fixed installer child-process handling by promisifying `execFile`.
- Fixed RTK binary discovery for Linux/macOS archives that contain `rtk-*` binary names.
- Added verbose RTK extraction file listing for debugging.

## v1.2.1
- `/combo` now reloads after applying state so modes activate immediately.
- RTK initial install now hard-fails if checksum verification is unavailable or invalid.
- `/ai-addons update rtk` now supports Windows, Linux, and macOS.
- `--dry-run` now includes Ponytail config registration preview.
