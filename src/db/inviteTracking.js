const database = require('./database');
const { isFakeJoin } = require('./inviteTrackingRules');
const { getPrimaryPool } = require('./postgres');
const { OFFSET_MS } = require('../utils/botTime');

const stat = (guildId, inviterId, deltas) => database.rpc('increment_invite_stat', {
  p_guild_id: guildId, p_inviter_id: inviterId,
  p_joins_delta: deltas.joins ?? 0, p_leaves_delta: deltas.leaves ?? 0, p_fake_delta: deltas.fake ?? 0, p_bonus_delta: deltas.bonus ?? 0,
});

async function recordJoin(guildId, userId, inviterId, inviteCode, { accountCreatedAt = null, source = null } = {}) {
  const { data: previousRow } = await database.from('member_invites').select('user_id, inviter_id, fake').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  const fake = isFakeJoin({ accountCreatedAt, previousRow, fakeDays: (await getSettings(guildId)).fakeDays });
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

/** The invite settings of a server (the days under which an account is fake). */
async function getSettings(guildId) {
  try {
    const { rows } = await getPrimaryPool().query('select fake_days from invite_config where guild_id = $1', [String(guildId)]);
    return { fakeDays: rows[0]?.fake_days ?? 3 };
  } catch {
    return { fakeDays: 3 };
  }
}

async function setFakeDays(guildId, days) {
  await getPrimaryPool().query(
    'insert into invite_config (guild_id, fake_days) values ($1, $2) on conflict (guild_id) do update set fake_days = excluded.fake_days',
    [String(guildId), days],
  );
}

/** The start of this week (Monday) or month in Colombia (GMT-5), as an instant. */
function periodStart(period, now = new Date()) {
  const local = new Date(now.getTime() + OFFSET_MS);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = period === 'month' ? Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) : day - ((local.getUTCDay() + 6) % 7) * 86_400_000;
  return new Date(start - OFFSET_MS);
}

/** Top inviters of this week or month, from the members they brought in that period (fake joins are not counted). */
async function getPeriodLeaderboard(guildId, period, limit = 10) {
  const { rows } = await getPrimaryPool().query(
    `select inviter_id, count(*)::int as joins, count(*) filter (where left_at is not null)::int as leaves,
            (count(*) - count(*) filter (where left_at is not null))::int as net
       from member_invites where guild_id = $1 and inviter_id is not null and not fake and joined_at >= $2
      group by inviter_id order by net desc, joins desc limit $3`,
    [String(guildId), periodStart(period), Math.max(1, Math.min(50, limit))],
  );
  return rows.map((row) => ({ ...row, bonus: 0, fake: 0 }));
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

async function listRewards(guildId) {
  const { rows } = await getPrimaryPool().query('select invites, role_id from invite_rewards where guild_id = $1 order by invites asc', [String(guildId)]);
  return rows;
}

async function addReward(guildId, invites, roleId) {
  await getPrimaryPool().query(
    'insert into invite_rewards (guild_id, invites, role_id) values ($1, $2, $3) on conflict (guild_id, role_id) do update set invites = excluded.invites',
    [String(guildId), invites, String(roleId)],
  );
}

async function removeReward(guildId, roleId) {
  const { rowCount } = await getPrimaryPool().query('delete from invite_rewards where guild_id = $1 and role_id = $2', [String(guildId), String(roleId)]);
  return rowCount > 0;
}

/** Everybody the server has counted invites for (to give the roles of a new reward to those who already have enough). */
async function listInviterIds(guildId, limit = 500) {
  const { rows } = await getPrimaryPool().query('select inviter_id from invite_uses where guild_id = $1 order by joins desc limit $2', [String(guildId), limit]);
  return rows.map((row) => row.inviter_id);
}

module.exports = { getSettings, setFakeDays, periodStart, getPeriodLeaderboard, listRewards, addReward, removeReward, listInviterIds, recordJoin, recordLeave, getStats, getLeaderboard, getInviter, listInvited, addBonus, resetUser, isFakeJoin };
