const countersDb = require('../db/counters');
const database = require('../db/database');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');
const { renderName, shouldRename } = require('../utils/counterNames');

const INTERVAL_MS = 60_000;
const RENAME_TIMEOUT_MS = 15_000;
// Counting bots, pending members or boosters needs every member, and the cache only holds the ones that
// were seen. A full fetch is heavy, so it is repeated at most this often and skipped for very large servers.
const MEMBER_REFRESH_MS = 10 * 60_000;
const MEMBER_FETCH_TIMEOUT_MS = 60_000;
const MEMBER_FETCH_MAX_GUILD = 50_000;
const NEEDS_MEMBERS = new Set(['users_only', 'bots_only', 'pending_members', 'booster_count']);
const WARN_EVERY_MS = 60 * 60_000;

const memberFetchedAt = new Map();
const lastRenamedAt = new Map();
const lastWantedName = new Map();
const lastStoredName = new Map();
const lastWarnAt = new Map();

function countGuild(guild, option) {
  if (/^\d{10}$/.test(option)) {
    let seconds = Number(option) - Math.floor(Date.now() / 1000);
    return seconds > 0 ? formatDuration(seconds) : 'now';
  }
  const channels = guild.channels.cache;
  const members = guild.members.cache;
  switch (option) {
    case 'members': return guild.memberCount;
    case 'users_only': return members.filter((m) => !m.user.bot).size;
    case 'bots_only': return members.filter((m) => m.user.bot).size;
    case 'pending_members': return members.filter((m) => m.pending).size;
    case 'all_channels': return channels.size;
    case 'text_channels': return channels.filter((c) => c.type === 0).size;
    case 'voice_channels': return channels.filter((c) => c.type === 2).size;
    case 'categories': return channels.filter((c) => c.type === 4).size;
    case 'announcement_channels': return channels.filter((c) => c.type === 5).size;
    case 'staging_channels': return channels.filter((c) => c.type === 13).size;
    case 'boosts': return guild.premiumSubscriptionCount ?? 0;
    case 'booster_count': return members.filter((m) => m.premiumSince).size;
    default: return 0;
  }
}

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); const secs = seconds % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function warnOnce(key, ...args) {
  const now = Date.now();
  if (now - (lastWarnAt.get(key) ?? 0) < WARN_EVERY_MS) return;
  lastWarnAt.set(key, now);
  logger.warn(...args);
}

/** Makes the member cache complete enough for the counters that need it. Falls back to what is cached. */
async function ensureMembers(guild, option) {
  if (!NEEDS_MEMBERS.has(option)) return;
  if ((guild.memberCount ?? 0) > MEMBER_FETCH_MAX_GUILD) return;
  if (guild.members.cache.size >= (guild.memberCount ?? 0)) return;
  const last = memberFetchedAt.get(guild.id) ?? 0;
  if (Date.now() - last < MEMBER_REFRESH_MS) return;
  memberFetchedAt.set(guild.id, Date.now());
  try {
    await withTimeout(guild.members.fetch(), MEMBER_FETCH_TIMEOUT_MS, 'member fetch');
  } catch (err) {
    warnOnce(`members:${guild.id}`, { guildId: guild.id, action: 'counter-members' }, `Could not load every member for counters, using the cached ones: ${err.message}`);
  }
}

async function updateCounters(client) {
  const rows = await countersDb.listAll();
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.guild_id)) grouped.set(row.guild_id, []);
    grouped.get(row.guild_id).push(row);
  }
  await forEachWithConcurrency(grouped, async ([guildId, guildRows]) => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    for (const row of guildRows) {
      if (!row.enabled) continue;
      if (row.last_updated_at && Date.now() - Date.parse(row.last_updated_at) < (row.interval_seconds ?? 60) * 1000) continue;
      const channel = guild.channels.cache.get(row.channel_id);
      if (!channel) { await countersDb.remove(guildId, row.channel_id).catch(() => {}); continue; }
      await ensureMembers(guild, row.counter_option);
      const name = renderName(row, countGuild(guild, row.counter_option));
      const wanted = shouldRename({
        currentName: channel.name,
        wantedName: name,
        channelType: row.channel_type,
        lastWanted: lastWantedName.get(channel.id),
        lastStored: lastStoredName.get(channel.id),
        renamedAt: lastRenamedAt.get(channel.id),
        now: Date.now(),
      });
      if (wanted) {
        try {
          const renamed = await withTimeout(channel.setName(name, 'Update Petto counter'), RENAME_TIMEOUT_MS, 'channel rename');
          lastRenamedAt.set(channel.id, Date.now());
          lastWantedName.set(channel.id, name);
          lastStoredName.set(channel.id, renamed?.name ?? name);
        } catch (err) {
          // Usually a missing Manage Channels permission or a rename limit. Say so instead of staying silent.
          warnOnce(`rename:${channel.id}`, { guildId, channelId: channel.id, action: 'counter-rename' }, `Could not update counter channel: ${err.message}`);
        }
      }
      await database.from('server_counters').update({ last_updated_at: new Date().toISOString() }).eq('id', row.id).catch(() => {});
    }
  }, config.jobConcurrency);
}

function startCounterJob(client) {
  const run = exclusiveTask(() => updateCounters(client));
  run().catch((err) => logger.error('Initial counter update failed:', err));
  setInterval(() => run().catch((err) => logger.error('Counter job error:', err)), INTERVAL_MS).unref?.();
  logger.info('Counter job started (checking every 60s).');
}

module.exports = { startCounterJob, updateCounters, countGuild };
