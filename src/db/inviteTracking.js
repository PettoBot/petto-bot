const database = require('./database');
const { isFakeJoin } = require('./inviteTrackingRules');
const { getPrimaryPool } = require('./postgres');

const stat = (guildId, inviterId, deltas) => database.rpc('increment_invite_stat', {
  p_guild_id: guildId, p_inviter_id: inviterId,
  p_joins_delta: deltas.joins ?? 0, p_leaves_delta: deltas.leaves ?? 0, p_fake_delta: deltas.fake ?? 0, p_bonus_delta: deltas.bonus ?? 0,
});

async function recordJoin(guildId, userId, inviterId, inviteCode, { accountCreatedAt = null, source = null } = {}) {
  const { data: previousRow } = await database.from('member_invites').select('user_id, inviter_id, fake').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  const fake = isFakeJoin({ accountCreatedAt, previousRow });
  const where = source ?? (inviterId ? 'invite' : 'unknown');

  const { error } = await database
    .from('member_invites')
    .upsert({ guild_id: guildId, user_id: userId, inviter_id: inviterId, invite_code: inviteCode, joined_at: new Date().toISOString(), left_at: null, fake, source: where }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;

  if (inviterId) {
    const { error: rpcError } = await stat(guildId, inviterId, fake ? { fake: 1 } : { joins: 1 });
    if (rpcError) throw rpcError;
  }
  return { fake, source: where };
}

async function recordLeave(guildId, userId) {
  const { data: row, error } = await database.from('member_invites').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!row) return null;

  await database.from('member_invites').update({ left_at: new Date().toISOString() }).eq('guild_id', guildId).eq('user_id', userId);

  // A fake join was never counted as an invite, so its leaving is not counted either.
  if (row.inviter_id && !row.fake) {
    const { error: rpcError } = await stat(guildId, row.inviter_id, { leaves: 1 });
    if (rpcError) throw rpcError;
  }
  return row;
}

const empty = { joins: 0, leaves: 0, fake: 0, bonus: 0 };

async function getStats(guildId, inviterId) {
  const { data, error } = await database.from('invite_uses').select('*').eq('guild_id', guildId).eq('inviter_id', inviterId).maybeSingle();
  if (error) throw error;
  return { ...empty, ...(data ?? {}) };
}

/** Top inviters by net invites (joined - left + bonus). */
async function getLeaderboard(guildId, limit = 10) {
  const { rows } = await getPrimaryPool().query(
    `select inviter_id, joins, leaves, fake, bonus, (joins - leaves + bonus) as net from invite_uses
     where guild_id = $1 and (joins <> 0 or leaves <> 0 or bonus <> 0) order by net desc, joins desc limit $2`,
    [String(guildId), Math.max(1, Math.min(50, limit))],
  );
  return rows;
}

async function getInviter(guildId, userId) {
  const { data, error } = await database.from('member_invites').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Members a user brought in, newest first (those still in the server are marked). */
async function listInvited(guildId, inviterId, limit = 10) {
  const { data, error } = await database.from('member_invites').select('user_id, joined_at, left_at, fake, invite_code').eq('guild_id', guildId).eq('inviter_id', inviterId).order('joined_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Adds (or, negative, takes away) bonus invites. */
async function addBonus(guildId, inviterId, amount) {
  const { error } = await stat(guildId, inviterId, { bonus: Math.trunc(amount) });
  if (error) throw error;
  return getStats(guildId, inviterId);
}

/** Puts one user's counters back to zero (the record of who invited whom is kept). */
async function resetUser(guildId, inviterId) {
  const { error } = await database.from('invite_uses').update({ joins: 0, leaves: 0, fake: 0, bonus: 0 }).eq('guild_id', guildId).eq('inviter_id', inviterId);
  if (error) throw error;
}

module.exports = { recordJoin, recordLeave, getStats, getLeaderboard, getInviter, listInvited, addBonus, resetUser, isFakeJoin };
