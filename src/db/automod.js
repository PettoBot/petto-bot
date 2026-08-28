const supabase = require('./supabase');
const { createExpiringCache } = require('../utils/expiringCache');

const configCache = createExpiringCache(15_000);
const silentChannelCache = createExpiringCache(15_000);

async function getConfig(guildId) {
  return configCache.get(guildId, async () => {
    const { data, error } = await supabase.from('automod_config').select('*').eq('guild_id', guildId).maybeSingle();
    if (error) throw error;
    return data;
  });
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await supabase
    .from('automod_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  configCache.set(guildId, data);
  return data;
}

async function addBannedWord(guildId, word) {
  const config = (await getConfig(guildId)) ?? { banned_words: [] };
  const words = new Set((config.banned_words ?? []).map((w) => w.toLowerCase()));
  words.add(word.toLowerCase());
  return upsertConfig(guildId, { banned_words: [...words] });
}

async function removeBannedWord(guildId, word) {
  const config = (await getConfig(guildId)) ?? { banned_words: [] };
  const words = (config.banned_words ?? []).filter((w) => w.toLowerCase() !== word.toLowerCase());
  return upsertConfig(guildId, { banned_words: words });
}

async function addImmuneRole(guildId, roleId) {
  const config = (await getConfig(guildId)) ?? { immune_role_ids: [] };
  const ids = new Set(config.immune_role_ids ?? []);
  ids.add(roleId);
  return upsertConfig(guildId, { immune_role_ids: [...ids] });
}

async function removeImmuneRole(guildId, roleId) {
  const config = (await getConfig(guildId)) ?? { immune_role_ids: [] };
  const ids = (config.immune_role_ids ?? []).filter((id) => id !== roleId);
  return upsertConfig(guildId, { immune_role_ids: ids });
}

async function getSilentChannel(guildId, channelId) {
  const rows = await listSilentChannelsCached(guildId);
  return rows.find((row) => row.channel_id === channelId) ?? null;
}

async function listSilentChannels(guildId) {
  const { data, error } = await supabase.from('automod_silent_channels').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function listSilentChannelsCached(guildId) {
  return silentChannelCache.get(guildId, () => listSilentChannels(guildId));
}

async function addSilentChannel(guildId, channelId, action = 'warn') {
  const { error } = await supabase.from('automod_silent_channels').upsert({ guild_id: guildId, channel_id: channelId, action }, { onConflict: 'guild_id,channel_id' });
  if (error) throw error;
  silentChannelCache.delete(guildId);
}

async function removeSilentChannel(guildId, channelId) {
  const { data, error } = await supabase.from('automod_silent_channels').delete().eq('guild_id', guildId).eq('channel_id', channelId).select('channel_id');
  if (error) throw error;
  silentChannelCache.delete(guildId);
  return data.length > 0;
}

module.exports = {
  getConfig,
  upsertConfig,
  addBannedWord,
  removeBannedWord,
  addImmuneRole,
  removeImmuneRole,
  getSilentChannel,
  listSilentChannels,
  listSilentChannelsCached,
  addSilentChannel,
  removeSilentChannel,
};
