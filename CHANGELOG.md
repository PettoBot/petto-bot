# Changelog

All notable changes to Petto are documented here.

## [0.4.0] — 2026-08-24

### Added

- Added the English prefix-only Honeypot system with a Components V2 warning panel, bundled Petto Honeypot artwork, persistent trigger counts, moderation cases, sanctions logs, and automod detection logs.
- Added the Petto Vault backup center with a Components V2 action menu, loading state, audited create/export/restore/schedule flows, and safety backups before restores.
- Added server-scoped backup numbers so each guild starts at `#1`; the internal database ID is no longer exposed to staff or the dashboard.

### Changed

- Custom prefixes now match case-insensitively and accept optional whitespace between a prefix and command.
- Prefix moderation target resolution accepts mentions, Discord IDs, exact usernames, and exact display names, while rejecting ambiguous names safely.
- Honeypot panels use the bundled `petto-honeypot.png` attachment and `<:petto_honeypot:1541493688054841405>` button emoji instead of a third-party image URL.

### Validation

- `npm run check` passes across the complete JavaScript source tree.
- CI now runs JavaScript syntax checks, TypeScript checks, generated-source
  consistency checks, and a production dependency audit.

### Security and deployment

- GitHub Actions now use immutable commit-pinned releases for checkout,
  CodeQL, and Node.js setup.
- Updated the vulnerable `undici` transitive dependency to `6.28.0`, removing
  the three moderate Dependabot findings reported for the previous lockfile.
- Discloud builds the checked-in TypeScript module before starting the bot,
  keeping GitHub-based deployments aligned with the repository source.

## [0.3.0-2] — 2026-08-22

### Added

- Added Discord REST rate-limit telemetry. Petto now reports the HTTP method, sanitized route, scope, retry delay, and bucket limit when Discord applies a rate limit.
- Added one-minute deduplication so repeated limits remain visible without flooding the operational log.

### Changed

- Bumped the bot version from `0.1.0` to `0.3.0-2`.

### Validation

- `npm run check` passes across the complete JavaScript source tree.
