const { EMOJI } = require('./emojis');

const RELEASES = [
  {
    version: 'v0.6.0',
    label: 'v0.6.0 · Dashboard, embeds & Petto Vanity',
    date: '2026-09-30',
    accent: 0x8c7cff,
    status: `${EMOJI.RELEASE_APPROVED} Latest`,
    summary: 'A release focused on the dashboard: it speaks Spanish and Brazilian Portuguese, previews messages like Discord, connects to the Embed Builder, and now also manages the separate Petto Vanity bot.',
    sections: [
      {
        title: `${EMOJI.RELEASE_MAGIC} Dashboard`,
        items: [
          'The whole dashboard is translated to Spanish and Brazilian Portuguese, with `/es/dash` and `/pt-br/dash` and a language menu that remembers the choice.',
          'Message previews render like the Embed Builder, with markdown, links, mentions, emojis and timestamps, and show the bot\'s own name and avatar, including a custom one, also in the join gate.',
          'Server lists are cached for a short time and Premium is read once per request, so pages load faster.',
          'Fixed the dashboard not scrolling on small screens in the built site, and fixed preview freezes.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_LINK} Embeds & variables`,
        items: [
          'Dashboard messages can be sent to the Embed Builder with a share code, messages sent from it can be opened in the dashboard, and a test message can be sent to a channel.',
          'Added a registry of the embed variables and `GET /api/dashboard/variables`, so the dashboard reads the list from the bot. `npm run check` now fails when the registry and the variable engine disagree.',
          'Fixed a crash when an embed command was used without an embed name.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Petto Vanity`,
        items: [
          'The separate Petto Vanity bot can be managed from the dashboard: vanity rules, Server Tag rules, thank-you messages and the staff log.',
          'Petto Vanity reports its state, servers, latency and uptime, with a public status page on the Petto site.',
        ],
      },
    ],
  },
  {
    version: 'v5.0.1-46',
    label: 'v5.0.1-46 · Reliability, safety & automation',
    date: '2026-09-24',
    accent: 0x8c7cff,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A reliability and safety release with persistent malicious-link detection, stronger guild operations, independent moderation cases, and argument-aware custom commands.',
    sections: [
      {
        title: `${EMOJI.RELEASE_BUG} Reliability & onboarding`,
        items: [
          'Fixed webhook counters and mention handling when sending webhook notifications.',
          'Fixed VoiceMaster interaction handling and improved resilience against transient PostgreSQL gateway timeouts.',
          'Added safe retries for transient database reads and stale-cache fallbacks for known configuration.',
          'Reduced database pressure from sticky messages and autoresponders, while preventing unsafe XP write retries.',
          'Fixed excessive permission overwrites and improved onboarding channel creation for large guilds.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_LOCKED} AutoMod & malicious links`,
        items: [
          'Added persistent malicious-URL detection for links discovered through `!am`.',
          'Known malicious URLs are reused from storage instead of being checked with an external service on every message.',
          'Known malicious links are removed automatically, and the development team is alerted when a new URL is detected.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Guild operations & compliance`,
        items: [
          'Added the `guildsend` team command and automated guild diagnostics and compliance monitoring.',
          'Added shop/store/compliance detection, team review alerts, manual scans, leave confirmation controls, and clearer guild notices.',
        ],
      },
      {
        title: `${EMOJI.HAMMER} Moderation cases`,
        items: [
          'Case numbers are now independent per guild and stored through persistent guild counters.',
          'All moderation sanctions and automated actions share one per-guild sequence, with a migration for existing case history.',
          '`case list` no longer requires a user and now supports optional user filtering and pagination.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Custom command arguments`,
        items: [
          'Added `{args}`, `{arg1}` through `{arg10}`, `{args_from:N}`, `{arg_count}`, `{command_name}`, and `{prefix}`.',
          'Quoted text stays together as one argument, saved embed templates support the new variables, and user-provided arguments cannot create mass mentions.',
          'Custom commands can now use embed-only templates, editing preserves unchanged fields, and the command editor includes a variables reference.',
        ],
      },
    ],
  },
  {
    version: 'v0.5.0',
    label: 'v0.5.0 · Connected roles & activity',
    date: '2026-08-31',
    accent: 0x5eead4,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A connected release for linked roles, instant prefix sync, richer activity summaries, and social roleplay.',
    sections: [
      {
        title: `${EMOJI.RELEASE_LINK} Connected roles & dashboard`,
        items: [
          'Added the linked-roles connection flow so members can connect Petto to Discord and receive the Petto Verified role in participating servers.',
          'The web stores the server prefix through the private bot API and notifies the bot immediately.',
          'The bot refreshes its prefix cache immediately, and resetting the prefix synchronizes the default `!` prefix again.',
          'Server nicknames remain free; Premium continues to cover the other server profile customization fields.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_ROCKET} Activity & roleplay`,
        items: [
          'Added the `!summary`, `!weekly`, and `!digest` activity chart with dark Overview styling, daily green/orange series, and a text-only fallback when Canvas is unavailable.',
          'Added Respond/Reject controls to targeted roleplay commands. The mentioned member can respond once with the same action or reject with a slap.',
          'Added persistent per-server, per-user, per-action roleplay counters and new commands: `!hi`, `!bye`, `!yes`, `!no`, `!laugh`, `!sad`, and `!angry`.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes & safety`,
        items: [
          'Fixed the statistics job\'s `.catch()` handling and updated setup/removal messages for clearer server configuration.',
          'Added rate limiting to the internal prefix API to reduce abuse and satisfy the security checks.',
          'Changed booster eligibility copy to use Discord\'s `server booster` terminology.',
        ],
      },
    ],
  },
  {
    version: 'v0.4.1',
    label: 'v0.4.1 · Reports & reliability',
    date: '2026-08-26',
    accent: 0xfe6465,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A focused update for reports, Premium server changes, profile details, and operational logs.',
    sections: [
      {
        title: `${EMOJI.REPORT} Reports`,
        items: [
          'Improved the report system and added the native `/report config` configuration form.',
          'Added the urgent moderator role selector and connected the new report settings to Community Configs.',
          'Report cards preserve the reported message link, text, and image attachments when available.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes & reliability`,
        items: [
          'Fixed the Premium issue that could block changing the active server or hide an existing Premium assignment.',
          'Improved audit-log caching, retries, stale fallbacks, and partial-message handling.',
          'Centralized event error handling so one rejected handler does not silently disappear.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_EYES} Profile tools`,
        items: [
          'Improved `!ui` and `!userinfo` with fresh profile data, banners, avatars, roles, badges, timestamps, and profile links.',
          'Added better media-change detection and more useful information for staff reviewing a member.',
        ],
      },
    ],
  },
  {
    version: 'v0.4.0',
    label: 'v0.4.0 · Safety systems',
    date: '2026-08-24',
    accent: 0x8c7cff,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A major safety release with Honeypot, Petto Vault, stronger prefix parsing, and safer setup flows.',
    sections: [
      {
        title: `${EMOJI.RELEASE_ROCKET} New systems`,
        items: [
          'Added the Components V2 Honeypot panel with trigger counts, moderation cases, sanctions logs, and automod logs.',
          'Added Petto Vault backup flows for create, list, export, restore, schedules, audit history, and safety backups.',
          'Backup numbers are scoped per server so staff see `#1`, `#2`, and so on instead of internal database IDs.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_LOCKED} Moderation & safety`,
        items: [
          'Custom prefixes are case-insensitive and accept optional whitespace before a command.',
          'Moderation targets accept mentions, IDs, exact usernames, and exact display names while rejecting ambiguous names.',
          'Setup now opts into AutoMod explicitly and reports partial permission or channel failures separately.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Experience`,
        items: [
          'Honeypot and Vault panels use Petto artwork and Components V2 controls.',
          'Report flows support urgent roles, anonymous reports, image attachments, and the new red report indicators.',
          'Removed automatic invite creation for Top.gg to keep the official invite flow private and intentional.',
        ],
      },
    ],
  },
  {
    version: 'v0.3.0-2',
    label: 'v0.3.0-2 · Operational visibility',
    date: '2026-08-22',
    accent: 0x4b4f59,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'The operational visibility release for Discord REST rate limits and bot version tracking.',
    sections: [
      {
        title: `${EMOJI.RELEASE_METAL} Reliability`,
        items: [
          'Added Discord REST rate-limit telemetry with method, sanitized route, scope, retry delay, and bucket limit.',
          'Repeated rate-limit events are grouped for one minute so the log stays useful without flooding staff.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_NOTE} Release notes`,
        items: [
          'Bumped the bot version from `0.1.0` to `0.3.0-2` and documented the validation status.',
        ],
      },
    ],
  },
  {
    version: 'v0.3.0-1',
    label: 'v0.3.0-1 · Vanity system',
    date: '2026-08-13',
    accent: 0x5c8dff,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'Introduced Petto\'s Vanity system and documented the first public version of that release.',
    sections: [
      {
        title: `${EMOJI.RELEASE_MAGIC} Vanity`,
        items: [
          'Added the Vanity system for managing and presenting a server\'s vanity identity through Petto.',
          'The original release entry and its full notes are available in the public changelog.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_LINK} More details`,
        items: [
          'See the August 13, 2026 entry in the Petto changelog for the complete release context.',
        ],
      },
    ],
  },
];

function getRelease(version) {
  return RELEASES.find((release) => release.version === version) ?? null;
}

function getLatestRelease() {
  return RELEASES[0];
}

function getReleaseIndex(version) {
  const index = RELEASES.findIndex((release) => release.version === version);
  return index === -1 ? 0 : index;
}

module.exports = { RELEASES, getRelease, getLatestRelease, getReleaseIndex };
