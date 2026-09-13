const supabase = require('./supabase');
const { createExpiringCache } = require('../utils/expiringCache');
const { retryIdempotent } = require('../utils/transientDb');

const stickyCache = createExpiringCache(15_000);
const cacheKey = (guildId, channelId) => `${guildId}:${channelId}`;

async function getSticky(guildId, channelId) {
  const key = cacheKey(guildId, channelId);
  return stickyCache.get(key, async () => {
    const { data, error } = await supabase.from('sticky_messages').select('*').eq('guild_id', guildId).eq('channel_id', channelId).maybeSingle();
    if (error) throw error;
    return data;
  }, { staleIfError: true });
}

async function listForGuild(guildId) {
  const { data, error } = await supabase.from('sticky_messages').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function setSticky(guildId, channelId, content) {
  const data = await retryIdempotent(async () => {
    const { data: row, error } = await supabase.from('sticky_messages').upsert({ guild_id: guildId, channel_id: channelId, content, message_id: null }, { onConflict: 'guild_id,channel_id' }).select('*').single();
    if (error) throw error;
    return row;
  });
  stickyCache.set(cacheKey(guildId, channelId), data);
  return data;
}

async function setMessageId(guildId, channelId, messageId) {
  await retryIdempotent(async () => {
    const { error } = await supabase.from('sticky_messages').update({ message_id: messageId }).eq('guild_id', guildId).eq('channel_id', channelId);
    if (error) throw error;
  });
  stickyCache.delete(cacheKey(guildId, channelId));
}

async function removeSticky(guildId, channelId) {
  const removed = await retryIdempotent(async () => {
    const { data, error } = await supabase.from('sticky_messages').delete().eq('guild_id', guildId).eq('channel_id', channelId).select('channel_id');
    if (error) throw error;
    return data.length > 0;
  });
  stickyCache.delete(cacheKey(guildId, channelId));
  return removed;
}

module.exports = { getSticky, listForGuild, setSticky, setMessageId, removeSticky };
