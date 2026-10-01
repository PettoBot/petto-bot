# Changelog

All notable changes to Petto are documented here.

## [Unreleased]

### Added

- Added `/embed create name code:`: the whole embed can be written as one code, such as `{embed}&v{title: Welcome {user}}&v{description: Read the rules}&v{color: #ff91c2}`, and is saved and shown at once, without the editor panel. The format follows the embed scripting other bots use: blocks joined by `&v` (`$v` is read too), `&&` between the values of a block, and text before `{embed}` or `{message: ...}` for the message text. Blocks: `title`, `url`, `description`, `color`, `thumbnail`, `image`, `author`, `footer`, `field`, `timestamp`, `button` (link buttons) and `message`. Anything unsupported is reported and left out, nothing is saved if Discord would refuse the embed, and variables such as `{user}` work inside values. `/embed create` without a code opens the editor panel as before. A code with message text or buttons is saved in the dashboard's format and is edited there.
- Added a page about the embed code to `/embed vars`.
- Added `scripts/check-embed-script.js` to `npm run check`.
- Added **jail** (`!jail`, `!unjail`): a jailed member loses their roles and can only see the jail channel, where they can talk to staff. `jail setup` creates the Jailed role and the #jail channel and hides every other channel from the role; `jail user <user> [duration] [reason]`, `jail remove`, and `jail list` do the rest. The roles are saved before anything changes and given back on release, a timed jail ends by itself, a jailed member who leaves and rejoins is jailed again, new channels are hidden automatically, and a role handed to a jailed member by another bot is taken off again and kept for release. `warn escalation` can now use `jail` as its action.
- Added `!purge <amount> [user] [filter] [text]`: scans the last 1 to 500 messages and deletes those that match a member, a kind (`bots`, `humans`, `links`, `invites`, `attachments`, `images`, `embeds`, `mentions`) and some text. Pinned messages are kept.
- Added `!history [user]`: status (banned, in jail, timed out, muted), totals by kind, active warnings, staff notes, reports about the member and the latest cases, in one card.
- Added reports management: every report is numbered and stored, the report card has **Claim**, **Resolve**, **Dismiss**, **Release** and **Reopen** buttons, and `/report list`, `view`, `stats`, `block`, `unblock` and `blocklist` for staff. Reporters choose a category; servers can set a cooldown, a daily limit, a required reason, a role pinged on every report, a discussion thread per report and a DM to the reporter when a report is closed. Anonymous reports stay anonymous in every view.
- Added the **Report User** user context menu next to **Report Message**.
- Added **Report User** to the message Apps list too, so the person who wrote a message can be reported next to **Report Message**. Context menus are now keyed by name and type, so a user menu and a message menu can share a name.
- `/report config` is now a settings panel with selects and switches, a limits form and a **Send test report** button that also checks Petto can post in the channel.
- Added `!roll` (`2d6+3`, `d20`, `4d6kh3`), `!choose`, and the fun commands `!8ball`, `!ship` and `!rps` in a new **Fun** help category.
- Added `scripts/check-reports.js`, `check-jail.js`, `check-purge.js`, `check-dice.js` and `check-fun.js` to `npm run check`.

### Changed

- **Resolve**, **Dismiss** and **Reopen** on a report now ask for a required reason, and sending the form is the confirmation. A closing reason is shown on the report card, written in the report thread and sent to the reporter in the DM; a reopening reason is shown on the card ("reopened by …") and written in the thread.
- The report thread now follows the report: it is locked and archived when the report is resolved or dismissed, and opened again when the report is reopened.
- Added **Invite reporter** to the report card, which adds the reporter to the discussion thread (not offered for anonymous reports), and a **Notify on claim** setting that DMs the reporter when staff claim their report.
- `/setup` now opens a status panel that answers immediately: what is configured, which permissions Petto is missing, and a **Quick setup** form that is pre-filled from the current settings, so running it again never resets anything. Submitting the form runs its steps together and reports each one separately, so one failing step no longer stops the rest. Audit log routes are saved in one statement instead of eleven.
- Roleplay responses (**Respond** / **Reject**) are now a reply to the message that holds the buttons instead of an edit of it, so the original message keeps its text and only loses its buttons. The reply never mentions anyone.
- `!report send` takes a multi-word reason without quotes; the category, ping and anonymous options go after it as `--category`, `--ping` and `--anonymous`.
- Redesigned the info commands as Components V2 cards with one shared layout (heading with picture, optional banner, sections, ID footer and link buttons): `serverinfo`, `userinfo`, `botinfo`, `channelinfo`, `roleinfo`, `emojiinfo`, `inviteinfo`, `avatar`, `banner`, `color`, `roles`, `permissions` and `invites`. Mentions inside the cards no longer ping.
- `serverinfo` now shows the server description and banner, stickers, forums and language, and only shows the human, bot and booster counts when every member is cached, so they are never wrong on large servers. `userinfo` shows the join position under the same rule, lists roles without cutting a mention in half, and shows an active timeout. `roleinfo` now lists the key permissions of the role, and `permissions` groups them by Server, Text and Voice.
- Added `scripts/check-info-cards.js` to `npm run check`. It runs every info command against fake data and checks Discord's component, text and button limits.
- `!remind` now accepts the shorthand `!remind 2h text` for `!remind add 2h text`. `list` and `cancel` work as before.
- Redesigned the `!version` release center with a cleaner Components V2 layout: a header with the version, status and date, clearer section spacing, and no filler text.
- Redesigned `!case list` as a Components V2 card: a header with the server or user picture and the case count, one block per case with its type, people, time and status (active or ended for timed sanctions), and page controls with the current page.

### Fixed

- Fixed live counters (`/counter`) that stopped updating. Text and announcement channels cannot keep capitals or spaces, so the stored name never matched and the same channel was renamed on every pass, past Discord's limit of about two renames every ten minutes. The renames waited in line and held up every other counter. A channel is now renamed only when its name really changes, with at least five minutes between renames, and a rename that waits too long no longer blocks the rest.
- Fixed the counters for users, bots, pending members and boosters, which counted only the members the bot had seen. They now load the full member list, at most every ten minutes, and fall back to the cached members on very large servers or when the load fails.
- A counter that cannot be renamed, for example without Manage Channels, is now logged instead of failing silently.
- Added `scripts/check-counters.js` to `npm run check`. It runs the counter job against a fake server.
- Fixed the release name in `!version`: `v5.0.1-46` is now shown as `v0.5.1-46`.
- Fixed `v0.5.0` still being marked as the latest release in `!version`.
- Fixed `!case list` showing an empty page when cases were deleted while the list was open.

## [0.6.0] — 2026-09-30

### Added

- Added a registry of the embed variables (`src/utils/embedVariableRegistry.js`) and a check in `npm run check` that fails when it and the variable engine disagree.
- Added `GET /api/dashboard/variables`, which returns that registry to the dashboard.
- Added the 0.6.0 release notes to `/version`.

### Fixed

- Fixed embed commands crashing when no embed name is given.

### Changed

- The dashboard, released alongside, is translated to Spanish and Brazilian Portuguese, previews messages like the Embed Builder with the bot's own name and avatar, connects to the Embed Builder, loads faster, and now manages the separate Petto Vanity bot. These changes live in the `petto-web` repository.
- The package version is now `0.6.0`. The previous `5.0.1-46` was a typo for `0.5.1-46`.

## [5.0.1-46] — 2026-09-24

### Fixed

- Fixed webhook counters and mention handling when sending webhook notifications.
- Fixed VoiceMaster interaction handling.
- Improved resilience against transient PostgreSQL gateway timeouts with safe retries for transient reads and stale-cache fallbacks.
- Reduced database pressure from sticky messages and autoresponders while preventing unsafe XP write retries.
- Fixed excessive permission overwrites and improved onboarding channel creation for large guilds.

### Added

- Added persistent malicious-URL detection for links discovered through `!am`.
- Known malicious URLs are reused from storage instead of being checked with Safe Browsing on every message, removed automatically, and reported to the development team when newly detected.
- Added the `guildsend` team command and automated guild diagnostics and compliance monitoring, including shop/store detection, team review alerts, manual scans, leave confirmations, and clearer guild notices.
- Added independent per-guild moderation case numbers with persistent counters and one sequence shared by sanctions and automated actions.
- Added a migration for existing case history; `case list` now works without a user and supports optional user filtering and pagination.
- Added argument variables for custom commands: `{args}`, `{arg1}` through `{arg10}`, `{args_from:N}`, `{arg_count}`, `{command_name}`, and `{prefix}`.

### Changed

- Custom command arguments preserve quoted text as one argument and support the new variables inside saved embed templates.
- User-provided custom command arguments cannot create mass mentions.
- Custom commands can use embed-only templates, editing preserves unchanged fields, and the editor now includes a variables reference.

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
