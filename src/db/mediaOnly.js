const database = require('./database');
const { ensureGuild } = require('./guilds');
const { createExpiringCache } = require('../utils/expiringCache');

// Every message of a server reads this list, so it is kept for a little while; a change from the dashboard or a command arrives on
// petto:invalidate (with Redis) or is seen within 20 seconds.
const cache = createExpiringCache(20_000, { invalidateOn: ['media_only_channels'] });

const DEFAULTS = Object.freeze({
  attachments_enabled: false,
  links_enabled: false,
  allow_images: true,
  allow_videos: true,
  allow_audio: false,
  allow_files: false,
  networks: [],
  allow_caption: true,
  notice: true,
  bypass_role_ids: [],
});

/** Every media channel of a server: a Map of channel id → rule (with the defaults filled in). */
function getRules(guildId) {
  return cache.get(String(guildId), async () => {
    const { data, error } = await database.from('media_only_channels').select('*').eq('guild_id', String(guildId));
    if (error) throw error;
    return new Map((data ?? []).map((row) => [String(row.channel_id), { ...DEFAULTS, ...row }]));
  }, { staleIfError: true });
}

/** Creates or changes the rule of a channel (only the fields given). */
async function upsertRule(guildId, channelId, patch) {
  await ensureGuild(guildId);
  const { error } = await database.from('media_only_channels').upsert({ guild_id: String(guildId), channel_id: String(channelId), ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,channel_id' });
  if (error) throw error;
  cache.delete(String(guildId));
}

async function removeRule(guildId, channelId) {
  const { error } = await database.from('media_only_channels').delete().eq('guild_id', String(guildId)).eq('channel_id', String(channelId));
  if (error) throw error;
  cache.delete(String(guildId));
}

module.exports = { DEFAULTS, getRules, upsertRule, removeRule };
