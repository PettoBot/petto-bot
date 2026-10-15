const database = require('./database');
const { ensureGuild } = require('./guilds');

const DEFAULTS = {
  enabled: false,
  channel_id: null,
  listen_channel: false,
  allow_command: true,
  up_emoji: '<:Pe_nerdSuccess:1559577139328847963>',
  down_emoji: '<:Pe_nerdError:1559577090586841188>',
  thread: true,
  thread_name: 'Thread for suggestion {suggestion.id}', // i18n-ignore: English default kept in the database, shown translated
  self_vote: true,
  dm_author: true,
  anonymous: false,
  staff_role_id: null,
  embed_template: null,
  status_colors: true,
  color_pending: 0xffd563,
  color_approved: 0xa5ea7a,
  color_denied: 0xff6b6b,
  color_considering: 0xffb86c,
  color_implemented: 0xf78fb3,
};

async function getConfig(guildId) {
  const { data, error } = await database.from('suggestion_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, guild_id: guildId, ...(data ?? {}) };
}

async function updateConfig(guildId, patch) {
  await ensureGuild(guildId);
  const { data, error } = await database
    .from('suggestion_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  return { ...DEFAULTS, ...data };
}

/** The next number of a server's suggestions (the first is 1). */
async function nextNumber(guildId) {
  const { data, error } = await database.from('suggestions').select('number').eq('guild_id', guildId).order('number', { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0]?.number ?? 0) + 1;
}

async function createSuggestion(row) {
  await ensureGuild(row.guild_id);
  const { data, error } = await database.from('suggestions').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getSuggestion(guildId, id) {
  const { data, error } = await database.from('suggestions').select('*').eq('guild_id', guildId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function getByMessage(messageId) {
  const { data, error } = await database.from('suggestions').select('*').eq('message_id', messageId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getById(id) {
  const { data, error } = await database.from('suggestions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function updateSuggestion(id, patch) {
  const { data, error } = await database.from('suggestions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

async function deleteSuggestion(guildId, id) {
  const { data, error } = await database.from('suggestions').delete().eq('guild_id', guildId).eq('id', id).select('*');
  if (error) throw error;
  return data?.[0] ?? null;
}

async function listSuggestions(guildId, { status = null, limit = 10 } = {}) {
  let query = database.from('suggestions').select('*').eq('guild_id', guildId).order('number', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** How many suggestions a member made in the last `hours` hours (a small brake against spam). */
async function countRecent(guildId, userId, hours = 1) {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data, error } = await database.from('suggestions').select('id').eq('guild_id', guildId).eq('author_id', userId).gte('created_at', since).limit(50);
  if (error) throw error;
  return (data ?? []).length;
}

async function getVotes(suggestionId) {
  const { data, error } = await database.from('suggestion_votes').select('user_id,vote').eq('suggestion_id', suggestionId).limit(20000);
  if (error) throw error;
  return data ?? [];
}

/** Counts of the votes of a suggestion and what one member voted (0 when nothing). */
async function tally(suggestionId, userId = null) {
  const votes = await getVotes(suggestionId);
  return {
    up: votes.filter((v) => v.vote === 1).length,
    down: votes.filter((v) => v.vote === -1).length,
    mine: userId ? votes.find((v) => v.user_id === userId)?.vote ?? 0 : 0,
  };
}

async function setVote(suggestionId, userId, vote) {
  if (vote === 0) {
    const { error } = await database.from('suggestion_votes').delete().eq('suggestion_id', suggestionId).eq('user_id', userId);
    if (error) throw error;
    return;
  }
  const { error } = await database.from('suggestion_votes').upsert({ suggestion_id: suggestionId, user_id: userId, vote }, { onConflict: 'suggestion_id,user_id' });
  if (error) throw error;
}

async function isBlocked(guildId, userId) {
  const { data, error } = await database.from('suggestion_blocks').select('user_id').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function block(guildId, userId, by) {
  await ensureGuild(guildId);
  const { error } = await database.from('suggestion_blocks').upsert({ guild_id: guildId, user_id: userId, blocked_by: by }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
}

async function unblock(guildId, userId) {
  const { data, error } = await database.from('suggestion_blocks').delete().eq('guild_id', guildId).eq('user_id', userId).select('user_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = {
  DEFAULTS, getConfig, updateConfig, nextNumber, createSuggestion, getSuggestion, getByMessage, getById, updateSuggestion, deleteSuggestion,
  listSuggestions, countRecent, getVotes, tally, setVote, isBlocked, block, unblock,
};
