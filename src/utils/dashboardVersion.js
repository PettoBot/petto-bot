// i18n-ignore-file: internal names only.
// The dashboard shows a server's settings and keeps every open page of it current without reloading: it watches a change stamp per
// server, the Redis counter `petto:ver:<guildId>`, announced on `petto:ver` as `<guildId>:<n>`. The dashboard raises it for its own
// changes; the bot raises it here when it changes a setting the dashboard shows (a command, a setup wizard, a button), so the page of
// someone looking at that server shows it within a second. Without Redis nothing happens (the dashboard then sees it on its next read).
//
// Only tables of settings count (not XP, activity, members or logs, which change all the time), and a burst of writes to one server is
// one raise a moment later.
const redis = require('./redis');
const logger = require('./logger');

const VERSION_CHANNEL = 'ver'; // petto:ver
const VERSION_TTL_MS = 30 * 24 * 3600_000;
const DEBOUNCE_MS = 1_000;
const SNOWFLAKE = /^\d{15,25}$/;

const SETTINGS_SUFFIX = /_(?:config|settings|rules)$/;
const SETTINGS_TABLES = new Set([
  'guilds', 'custom_commands', 'auto_responders', 'reaction_roles', 'reaction_triggers', 'embed_templates', 'image_cards',
  'ticket_categories', 'ticket_panels', 'level_rewards', 'level_multipliers', 'xp_events', 'join_roles', 'sticky_messages',
  'starboards', 'monkeyboards', 'button_responders', 'component_panels', 'command_aliases', 'disabled_commands',
  'command_permission_levels', 'permission_groups', 'managed_webhooks', 'counters', 'auto_threads', 'log_entries', 'log_ignored',
  'automod_silent_channels', 'sanction_templates', 'poj_channels', 'bump_reminders', 'sender_identities', 'partner_blacklist',
  'appeal_forms', 'giveaway_presets', 'dash_access',
  // Forms: the forms, their panels, and the submissions the dashboard lists (a review from Discord shows there at once).
  'forms', 'form_panels', 'form_submissions',
  // The anti-nuke page shows its incidents and the lockdown (a panic lockdown starts and ends by itself).
  'antinuke_events', 'lockdowns',
  // The Honeypot page: its bait channels, the message of each one and the number caught.
  'honeypots',
]);

/** Whether a write to this table changes something the dashboard shows as a setting. */
function isSettingsTable(table) {
  const name = String(table || '');
  return SETTINGS_TABLES.has(name) || SETTINGS_SUFFIX.test(name);
}

const pending = new Map(); // guild id -> timer

async function raise(guildId) {
  const count = await redis.incr(`ver:${guildId}`, VERSION_TTL_MS);
  if (count) await redis.publish(VERSION_CHANNEL, `${guildId}:${count}`);
  return count;
}

/** Raises the stamp of a server a moment from now (several changes in a row become one). */
function noteDashboardChange(guildId) {
  const id = String(guildId ?? '');
  if (!SNOWFLAKE.test(id) || pending.has(id) || !redis.enabled()) return false;
  const timer = setTimeout(() => {
    pending.delete(id);
    raise(id).catch((error) => logger.debug?.(`[dashboard] raising the stamp of ${id} failed: ${error?.message ?? error}`));
  }, DEBOUNCE_MS);
  timer.unref?.();
  pending.set(id, timer);
  return true;
}

/** Called after a write to `table`: the server's stamp is raised when the table is one of settings. */
function noteTableWrite(table, guildId) {
  if (!isSettingsTable(table)) return false;
  return noteDashboardChange(guildId);
}

module.exports = { VERSION_CHANNEL, isSettingsTable, noteDashboardChange, noteTableWrite, raise };
