# Changelog

All notable changes to Petto are documented here.

## [0.3.0-2] — 2026-08-22

### Added

- Added Discord REST rate-limit telemetry. Petto now reports the HTTP method, sanitized route, scope, retry delay, and bucket limit when Discord applies a rate limit.
- Added one-minute deduplication so repeated limits remain visible without flooding the operational log.

### Changed

- Bumped the bot version from `0.1.0` to `0.3.0-2`.

### Validation

- `npm run check` passes across the complete JavaScript source tree.
