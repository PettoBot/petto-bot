const database = require('./database');
const { ensureGuild } = require('./guilds');

const DEFAULTS = {
  enabled: false,
  channel_id: null,
  review_channel_id: null,
  require_review: false,
  allow_command: true,
  allow_images: true,
  allow_replies: true,
  keep_author: true,
  use_webhook: true,
  webhook_name: 'Anonymous',
  webhook_avatar: null,
  title: 'Anonymous confession #{confession.number}',
  footer: 'Confession ID: {confession.id}',
  color: 0xa5ea7a,
  button_label: 'Confess',
  reply_label: 'Reply anonymously',
  panel_text: 'Press the button and write it. Nobody will know it was you.',
  cooldown_seconds: 60,
  staff_role_id: null,
  embed_template: null,
  panel_channel_id: null,
  panel_message_id: null,
};

async function getConfig(guildId) {
  const { data, error } = await database.from('confession_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, guild_id: guildId, ...(data ?? {}) };
}

async function updateConfig(guildId, patch) {
  await ensureGuild(guildId);
  const { data, error } = await database
    .from('confession_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  return { ...DEFAULTS, ...data };
}

/** The next number of a server's confessions (the first is 1). */
async function nextNumber(guildId) {
  const { data, error } = await database.from('confessions').select('number').eq('guild_id', guildId).order('number', { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0]?.number ?? 0) + 1;
}

async function create(row) {
  await ensureGuild(row.guild_id);
  const { data, error } = await database.from('confessions').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getById(id) {
  const { data, error } = await database.from('confessions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function getByNumber(guildId, number) {
  const { data, error } = await database.from('confessions').select('*').eq('guild_id', guildId).eq('number', number).maybeSingle();
  if (error) throw error;
  return data;
}

async function update(id, patch) {
  const { data, error } = await database.from('confessions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

async function remove(guildId, id) {
  const { data, error } = await database.from('confessions').delete().eq('guild_id', guildId).eq('id', id).select('*');
  if (error) throw error;
  return data?.[0] ?? null;
}

async function list(guildId, { status = null, limit = 10 } = {}) {
  let query = database.from('confessions').select('*').eq('guild_id', guildId).order('number', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** When a member made their last confession (null if never), for the cooldown. */
async function lastBy(guildId, userId) {
  const { data, error } = await database.from('confessions').select('created_at').eq('guild_id', guildId).eq('author_id', userId).order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.created_at ? new Date(data[0].created_at) : null;
}

async function isBlocked(guildId, userId) {
  const { data, error } = await database.from('confession_blocks').select('user_id').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function block(guildId, userId, by) {
  await ensureGuild(guildId);
  const { error } = await database.from('confession_blocks').upsert({ guild_id: guildId, user_id: userId, blocked_by: by }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
}

async function unblock(guildId, userId) {
  const { data, error } = await database.from('confession_blocks').delete().eq('guild_id', guildId).eq('user_id', userId).select('user_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = { DEFAULTS, getConfig, updateConfig, nextNumber, create, getById, getByNumber, update, remove, list, lastBy, isBlocked, block, unblock };
