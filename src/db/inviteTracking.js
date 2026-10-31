const database = require('./database');
const { isFakeJoin, inviteTotal, inviteTotalSql, DEFAULT_SETTINGS } = require('./inviteTrackingRules');
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

/**
 * A member left. One statement closes the row (only if it was still open, so a leave told twice counts once) and moves the numbers of the inviter:
 * a real join that ends within `quick_leave_minutes` of arriving goes from joins to fake, any other real join adds a leave, a fake join changes nothing.
 * Returns the row as it was before (with `quick`), or null when there was nothing open.
 */
async function recordLeave(guildId, userId) {
  const { quickLeaveMinutes } = await getSettings(guildId);
  const { rows } = await getPrimaryPool().query(
    `with old as (
       select inviter_id, invite_code, joined_at, fake, source from member_invites where guild_id = $1 and user_id = $2 and left_at is null for update
     ), closed as (
       update member_invites m set left_at = now(),
              fake = m.fake or (old.inviter_id is not null and $3::int > 0 and now() - old.joined_at <= $3::int * interval '1 minute')
         from old where m.guild_id = $1 and m.user_id = $2
       returning old.inviter_id, old.invite_code, old.joined_at, old.fake as was_fake, old.source, m.fake as is_fake, m.left_at
     ), moved as (
       update invite_uses u set joins = greatest(u.joins - (closed.is_fake)::int, 0), fake = u.fake + (closed.is_fake)::int, leaves = u.leaves + (not closed.is_fake)::int
         from closed where u.guild_id = $1 and u.inviter_id = closed.inviter_id and closed.inviter_id is not null and not closed.was_fake
       returning u.inviter_id
     )
     select inviter_id, invite_code, joined_at, left_at, source, was_fake as fake, (is_fake and not was_fake) as quick from closed`,
    [String(guildId), String(userId), quickLeaveMinutes],
  );
  return rows[0] ?? null;
}

const empty = { joins: 0, leaves: 0, fake: 0, bonus: 0 };

async function getStats(guildId, inviterId) {
  const { data, error } = await database.from('invite_uses').select('*').eq('guild_id', guildId).eq('inviter_id', inviterId).maybeSingle();
  if (error) throw error;
  const stats = { ...empty, ...(data ?? {}) };
  return { ...stats, total: inviteTotal(stats, (await getSettings(guildId)).subtractLeaves) };
}

const LEFT_COUNT = 'count(*) filter (where left_at is not null)'; // i18n-ignore: SQL, not a text for people
const SETTING_COLUMNS = { fakeDays: 'fake_days', quickLeaveMinutes: 'quick_leave_minutes', ignoreBots: 'ignore_bots', subtractLeaves: 'subtract_leaves' };

/** The invite settings of a server: the days under which an account is fake, the minutes of a quick leave, bots, and whether leaves are taken off the total. */
async function getSettings(guildId) {
  try {
    const { rows } = await getPrimaryPool().query('select fake_days, quick_leave_minutes, ignore_bots, subtract_leaves from invite_config where guild_id = $1', [String(guildId)]);
    const row = rows[0];
    return row
      ? { fakeDays: row.fake_days, quickLeaveMinutes: row.quick_leave_minutes, ignoreBots: row.ignore_bots, subtractLeaves: row.subtract_leaves }
      : { ...DEFAULT_SETTINGS };
  } catch {
    try {
      // A database that has not run the new schema yet only has the days.
      const { rows } = await getPrimaryPool().query('select fake_days from invite_config where guild_id = $1', [String(guildId)]);
      return { ...DEFAULT_SETTINGS, fakeDays: rows[0]?.fake_days ?? DEFAULT_SETTINGS.fakeDays };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
}

/** Saves the settings given (`{ fakeDays, quickLeaveMinutes, ignoreBots, subtractLeaves }`, already checked); the others stay as they are. */
async function setSettings(guildId, patch) {
  const keys = Object.keys(SETTING_COLUMNS).filter((key) => patch[key] !== undefined);
  if (!keys.length) return getSettings(guildId);
  const columns = keys.map((key) => SETTING_COLUMNS[key]);
  await getPrimaryPool().query(
    `insert into invite_config (guild_id, ${columns.join(', ')}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
     on conflict (guild_id) do update set ${columns.map((column) => `${column} = excluded.${column}`).join(', ')}`,
    [String(guildId), ...keys.map((key) => patch[key])],
  );
  return getSettings(guildId);
}

async function setFakeDays(guildId, days) {
  await setSettings(guildId, { fakeDays: days });
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
  const { subtractLeaves } = await getSettings(guildId);
  const { rows } = await getPrimaryPool().query(
    `select inviter_id, count(*)::int as joins, count(*) filter (where left_at is not null)::int as leaves,
            (${inviteTotalSql({ joins: 'count(*)', leaves: LEFT_COUNT, bonus: '0' }, '$4')})::int as net
       from member_invites where guild_id = $1 and inviter_id is not null and not fake and joined_at >= $2
      group by inviter_id order by net desc, joins desc limit $3`,
    [String(guildId), periodStart(period), Math.max(1, Math.min(50, limit)), subtractLeaves],
  );
  return rows.map((row) => ({ ...row, bonus: 0, fake: 0 }));
}

/** Top inviters by net invites (joined - left + bonus). */
async function getLeaderboard(guildId, limit = 10) {
  const { subtractLeaves } = await getSettings(guildId);
  const { rows } = await getPrimaryPool().query(
    `select inviter_id, joins, leaves, fake, bonus, ${inviteTotalSql({}, '$3')} as net from invite_uses
     where guild_id = $1 and (joins <> 0 or leaves <> 0 or bonus <> 0) order by net desc, joins desc limit $2`,
    [String(guildId), Math.max(1, Math.min(50, limit)), subtractLeaves],
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

module.exports = { getSettings, setSettings, setFakeDays, periodStart, getPeriodLeaderboard, listRewards, addReward, removeReward, listInviterIds, recordJoin, recordLeave, getStats, getLeaderboard, getInviter, listInvited, addBonus, resetUser, isFakeJoin };
