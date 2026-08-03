const countersDb = require('../db/counters');
const supabase = require('../db/supabase');
const logger = require('../utils/logger');

const INTERVAL_MS = 60_000;

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

async function updateCounters(client) {
  const rows = await countersDb.listAll();
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.guild_id)) grouped.set(row.guild_id, []);
    grouped.get(row.guild_id).push(row);
  }
  for (const [guildId, guildRows] of grouped) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const row of guildRows) {
      if (!row.enabled) continue;
      if (row.last_updated_at && Date.now() - Date.parse(row.last_updated_at) < (row.interval_seconds ?? 60) * 1000) continue;
      const channel = guild.channels.cache.get(row.channel_id);
      if (!channel) { await countersDb.remove(guildId, row.channel_id).catch(() => {}); continue; }
      const rawValue = countGuild(guild, row.counter_option);
      const nameTemplate = row.name_template || '{option}: {value}';
      const name = `${row.prefix ?? ''}${nameTemplate.replaceAll('{option}', row.counter_option).replaceAll('{value}', String(rawValue)).replaceAll('{remaining}', String(rawValue))}${row.suffix ?? ''}`.slice(0, 100);
      if (channel.name !== name) await channel.setName(name, 'Update Petto counter').catch(() => {});
      await supabase.from('server_counters').update({ last_updated_at: new Date().toISOString() }).eq('id', row.id).catch(() => {});
    }
  }
}

function startCounterJob(client) {
  updateCounters(client).catch((err) => logger.error('Initial counter update failed:', err));
  setInterval(() => updateCounters(client).catch((err) => logger.error('Counter job error:', err)), INTERVAL_MS);
  logger.info('Counter job started (checking every 60s).');
}

module.exports = { startCounterJob, updateCounters, countGuild };
