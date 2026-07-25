const crypto = require('crypto');
const supabase = require('./supabase');

const MAX_PER_GUILD = 100;

function generateArId() {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars, same shape as bli's short ids
}

async function countForGuild(guildId) {
  const { count, error } = await supabase.from('auto_responders').select('id', { count: 'exact', head: true }).eq('guild_id', guildId);
  if (error) throw error;
  return count ?? 0;
}

async function listForGuild(guildId) {
  const { data, error } = await supabase.from('auto_responders').select('*').eq('guild_id', guildId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function getById(guildId, arId) {
  const { data, error } = await supabase.from('auto_responders').select('*').eq('guild_id', guildId).eq('ar_id', arId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getByTrigger(guildId, trigger) {
  const { data, error } = await supabase.from('auto_responders').select('*').eq('guild_id', guildId).ilike('trigger', trigger).maybeSingle();
  if (error) throw error;
  return data;
}

async function create(guildId, patch) {
  const count = await countForGuild(guildId);
  if (count >= MAX_PER_GUILD) {
    const err = new Error(`Limit reached (${MAX_PER_GUILD}). Remove one first.`);
    err.userFacing = true;
    throw err;
  }

  const { data, error } = await supabase.from('auto_responders').insert({ guild_id: guildId, ar_id: generateArId(), ...patch }).select('*').single();
  if (error) throw error;
  return data;
}

async function update(guildId, arId, patch) {
  const { data, error } = await supabase.from('auto_responders').update(patch).eq('guild_id', guildId).eq('ar_id', arId).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function removeByTrigger(guildId, trigger) {
  const { data, error } = await supabase.from('auto_responders').delete().eq('guild_id', guildId).ilike('trigger', trigger).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function removeAllForGuild(guildId) {
  const { data, error } = await supabase.from('auto_responders').delete().eq('guild_id', guildId).select('id');
  if (error) throw error;
  return data.length;
}

module.exports = { MAX_PER_GUILD, listForGuild, getById, getByTrigger, create, update, removeByTrigger, removeAllForGuild };
