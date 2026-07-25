const supabase = require('./supabase');

async function recordJoin(guildId, userId, inviterId, inviteCode) {
  const { error } = await supabase
    .from('member_invites')
    .upsert({ guild_id: guildId, user_id: userId, inviter_id: inviterId, invite_code: inviteCode, joined_at: new Date().toISOString(), left_at: null }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;

  if (inviterId) {
    const { error: rpcError } = await supabase.rpc('increment_invite_stat', { p_guild_id: guildId, p_inviter_id: inviterId, p_joins_delta: 1, p_leaves_delta: 0 });
    if (rpcError) throw rpcError;
  }
}

async function recordLeave(guildId, userId) {
  const { data: row, error } = await supabase.from('member_invites').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!row) return;

  await supabase.from('member_invites').update({ left_at: new Date().toISOString() }).eq('guild_id', guildId).eq('user_id', userId);

  if (row.inviter_id) {
    const { error: rpcError } = await supabase.rpc('increment_invite_stat', { p_guild_id: guildId, p_inviter_id: row.inviter_id, p_joins_delta: 0, p_leaves_delta: 1 });
    if (rpcError) throw rpcError;
  }
}

async function getStats(guildId, inviterId) {
  const { data, error } = await supabase.from('invite_uses').select('*').eq('guild_id', guildId).eq('inviter_id', inviterId).maybeSingle();
  if (error) throw error;
  return data ?? { joins: 0, leaves: 0 };
}

async function getLeaderboard(guildId, limit = 10) {
  const { data, error } = await supabase.from('invite_uses').select('*').eq('guild_id', guildId).order('joins', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

async function getInviter(guildId, userId) {
  const { data, error } = await supabase.from('member_invites').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { recordJoin, recordLeave, getStats, getLeaderboard, getInviter };
