const { EMOJI } = require('./emojis');

const RELEASES = [
  {
    version: 'v0.4.1',
    label: 'v0.4.1 · Reports & reliability',
    date: '2026-08-26',
    accent: 0xfe6465,
    status: `${EMOJI.RELEASE_APPROVED} Latest`,
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
