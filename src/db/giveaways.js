const supabase = require('./supabase');

// ── Giveaways ────────────────────────────────────────────────────────────

async function createGiveaway(row) {
  const { data, error } = await supabase.from('giveaways').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getGiveaway(id) {
  const { data, error } = await supabase.from('giveaways').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function getGiveawayByMessageId(guildId, messageId) {
  const { data, error } = await supabase.from('giveaways').select('*').eq('guild_id', guildId).eq('message_id', messageId).maybeSingle();
  if (error) throw error;
  return data;
}

async function setMessageId(id, messageId) {
  const { error } = await supabase.from('giveaways').update({ message_id: messageId }).eq('id', id);
  if (error) throw error;
}

async function updateGiveaway(id, patch) {
  const { data, error } = await supabase.from('giveaways').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

async function markEnded(id) {
  const { error } = await supabase.from('giveaways').update({ ended: true }).eq('id', id);
  if (error) throw error;
}

async function listDueGiveaways() {
  const { data, error } = await supabase.from('giveaways').select('*').eq('ended', false).lte('ends_at', new Date().toISOString());
  if (error) throw error;
  return data;
}

async function listActiveForGuild(guildId) {
  const { data, error } = await supabase.from('giveaways').select('*').eq('guild_id', guildId).eq('ended', false).order('ends_at', { ascending: true });
  if (error) throw error;
  return data;
}

// ── Entries ──────────────────────────────────────────────────────────────

async function addEntry(giveawayId, userId, weight) {
  const { error } = await supabase.from('giveaway_entries').upsert({ giveaway_id: giveawayId, user_id: userId, weight }, { onConflict: 'giveaway_id,user_id' });
  if (error) throw error;
}

async function removeEntry(giveawayId, userId) {
  const { error } = await supabase.from('giveaway_entries').delete().eq('giveaway_id', giveawayId).eq('user_id', userId);
  if (error) throw error;
}

async function hasEntry(giveawayId, userId) {
  const { data, error } = await supabase.from('giveaway_entries').select('user_id').eq('giveaway_id', giveawayId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function listEntries(giveawayId) {
  const { data, error } = await supabase.from('giveaway_entries').select('*').eq('giveaway_id', giveawayId);
  if (error) throw error;
  return data;
}

async function countEntries(giveawayId) {
  const { count, error } = await supabase.from('giveaway_entries').select('user_id', { count: 'exact', head: true }).eq('giveaway_id', giveawayId);
  if (error) throw error;
  return count ?? 0;
}

// ── Winners ──────────────────────────────────────────────────────────────

async function addWinner(giveawayId, userId, claimExpiresAt) {
  const { data, error } = await supabase
    .from('giveaway_winners')
    .insert({ giveaway_id: giveawayId, user_id: userId, claim_expires_at: claimExpiresAt, status: claimExpiresAt ? 'pending' : 'claimed' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getWinner(id) {
  const { data, error } = await supabase.from('giveaway_winners').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function listWinners(giveawayId) {
  const { data, error } = await supabase.from('giveaway_winners').select('*').eq('giveaway_id', giveawayId).order('won_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function setWinnerStatus(id, status) {
  const { data, error } = await supabase.from('giveaway_winners').update({ status }).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

async function listExpiredClaims() {
  const { data, error } = await supabase.from('giveaway_winners').select('*').eq('status', 'pending').not('claim_expires_at', 'is', null).lte('claim_expires_at', new Date().toISOString());
  if (error) throw error;
  return data;
}

module.exports = {
  createGiveaway,
  getGiveaway,
  getGiveawayByMessageId,
  setMessageId,
  updateGiveaway,
  markEnded,
  listDueGiveaways,
  listActiveForGuild,
  addEntry,
  removeEntry,
  hasEntry,
  listEntries,
  countEntries,
  addWinner,
  getWinner,
  listWinners,
  setWinnerStatus,
  listExpiredClaims,
};
