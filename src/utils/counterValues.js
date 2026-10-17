// What a counter counts in a server, read from the caches of discord.js (no requests). Kept apart from the job so the
// dashboard route, `!counter` and scripts/check-counters.js all count the same way.
const { t, currentLanguage } = require('../i18n');
const { NEEDS_PRESENCES, nextGoal, timeValue } = require('./counterNames');

const sizeOf = (collection, fn) => {
  if (!collection) return 0;
  if (typeof collection.filter === 'function') {
    const found = collection.filter(fn);
    return typeof found.size === 'number' ? found.size : found.length;
  }
  let n = 0;
  for (const item of collection.values()) if (fn(item)) n += 1;
  return n;
};

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

/**
 * The value of one counter: a number for most types, a text for clocks, dates and countdowns. `row` brings what some types need
 * (`target_id` the role, `timezone`, `goal`). Unknown types count 0.
 */
function countGuild(guild, option, lang = currentLanguage(), row = {}, now = Date.now()) {
  if (/^\d{10}$/.test(String(option))) {
    // A countdown in whole minutes: a channel cannot be renamed every second anyway.
    const seconds = Number(option) - Math.floor(now / 1000);
    return seconds > 0 ? formatDuration(seconds) : t(lang, 'counters.value.now');
  }
  const channels = guild.channels?.cache;
  const members = guild.members?.cache;
  const presences = guild.presences?.cache;
  const status = (wanted) => sizeOf(presences, (p) => (wanted ? p.status === wanted : p.status && p.status !== 'offline'));
  switch (option) {
    case 'members': return guild.memberCount ?? members?.size ?? 0;
    case 'goal': return guild.memberCount ?? members?.size ?? 0;
    case 'users_only': return sizeOf(members, (m) => !m.user?.bot);
    case 'bots_only': return sizeOf(members, (m) => m.user?.bot);
    case 'pending_members': return sizeOf(members, (m) => m.pending);
    case 'all_channels': return channels?.size ?? 0;
    case 'text_channels': return sizeOf(channels, (c) => c.type === 0);
    case 'voice_channels': return sizeOf(channels, (c) => c.type === 2);
    case 'categories': return sizeOf(channels, (c) => c.type === 4);
    case 'announcement_channels': return sizeOf(channels, (c) => c.type === 5);
    case 'staging_channels': return sizeOf(channels, (c) => c.type === 13);
    case 'boosts': return guild.premiumSubscriptionCount ?? 0;
    case 'booster_count': return sizeOf(members, (m) => m.premiumSince);
    case 'boost_level': return Number(guild.premiumTier ?? 0) || 0;
    case 'online': return status(null);
    case 'status_online': return status('online');
    case 'status_idle': return status('idle');
    case 'status_dnd': return status('dnd');
    case 'in_voice': return sizeOf(guild.voiceStates?.cache, (v) => v.channelId);
    // @everyone is a role for Discord, not for the people reading the counter.
    case 'roles': return Math.max(0, (guild.roles?.cache?.size ?? 1) - 1);
    case 'emojis': return guild.emojis?.cache?.size ?? 0;
    case 'stickers': return guild.stickers?.cache?.size ?? 0;
    case 'role_members': {
      const role = row.target_id ? guild.roles?.cache?.get(row.target_id) : null;
      if (!role) return 0;
      return sizeOf(members, (m) => m.roles?.cache?.has?.(role.id) ?? m._roles?.includes?.(role.id));
    }
    case 'clock':
    case 'date': return timeValue(option, { now, timeZone: row.timezone || 'UTC', lang });
    default: return 0;
  }
}

/** What the template needs besides the value: the goal of a goal counter and the name of the role of a role counter. */
function extrasFor(guild, row, value, now = Date.now()) {
  const extra = { now };
  if (row.counter_option === 'goal' && typeof value === 'number') extra.goal = nextGoal(value, row.goal);
  if (row.target_id) extra.role = guild.roles?.cache?.get(row.target_id)?.name ?? '';
  return extra;
}

/** Whether the counts of presences can be trusted: the bot needs the Presence intent for them. */
function hasPresences(guild) {
  return Boolean(guild.presences?.cache && guild.presences.cache.size > 0);
}

module.exports = { countGuild, extrasFor, hasPresences, formatDuration, NEEDS_PRESENCES };
