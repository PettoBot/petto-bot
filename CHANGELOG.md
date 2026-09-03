# Changelog

All notable changes to Petto are documented here.

## [0.5.0] — 2026-08-31

### Added

- Added the linked-roles connection flow so members can connect Petto to Discord and receive the Petto Verified role in participating servers.
- Added the `!summary`, `!weekly`, and `!digest` activity chart with daily green/orange series, dark Overview styling, and a text-only fallback when Canvas is unavailable.
- Added Respond/Reject controls to targeted roleplay commands. The mentioned member can respond once with the same action or reject with a slap.
- Added persistent per-server, per-user, per-action roleplay counters and new commands: `!hi`, `!bye`, `!yes`, `!no`, `!laugh`, `!sad`, and `!angry`.

### Changed

- Prefixes saved by the web dashboard now notify the bot through the internal API, refreshing its cache immediately instead of waiting for the five-minute interval.
- Resetting the prefix now synchronizes the default `!` prefix again.
- Server nicknames remain available without Premium; Premium continues to cover the other server profile customization fields.
- Updated setup and removal messages to make server configuration clearer.
- Changed booster eligibility copy to use Discord's `server booster` terminology.

### Fixed

- Fixed the statistics job's `.catch()` handling.
- Added rate limiting to the internal prefix API to prevent abusive requests and satisfy the security checks.

## [0.4.1] — 2026-08-26

### Added

- Added the prefix-only `!version` release center with a Components V2 version selector, navigation buttons, public changelog links, and the published `v0.4.1` entry.
- Added `/report config` improvements for the new report destination, urgent moderator role, anonymous reporting, and report-panel settings.

### Changed

- Improved report cards so message links, content, and image attachments remain available to moderators.
- Improved `!ui` and `!userinfo` with fresh profile data, banners, avatars, roles, badges, timestamps, and profile links.
- Improved audit-log caching, retries, stale fallbacks, partial-message handling, media-change detection, and central event error handling.

### Fixed

- Fixed the Premium issue that could block changing the active server or hide an existing Premium assignment.

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

## [0.3.0-1] — 2026-08-13

### Added

- Added the Vanity system and documented its first public release entry.
- Full notes are available in the [Petto changelog](https://petto.sbs/changelog/).
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
