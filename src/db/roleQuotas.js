// The rules of the role quotas of each server and the count of each member who holds one (see the tables in schema.sql).
const database = require('./database');
const { getPrimaryPool } = require('./postgres');
const { createExpiringCache } = require('../utils/expiringCache');

// Read by every message of a member who may hold a role with a quota, so the rules of a server stay in memory for a short time and every write below forgets them.
const rulesCache = createExpiringCache(30_000);

function listRules(guildId) {
  return rulesCache.get(String(guildId), async () => {
    const { data, error } = await database.from('role_quotas').select('*').eq('guild_id', guildId).order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  });
}

async function upsertRule(guildId, { roleId, periodDays, minMessages, maxStrikes, notifyDm = true, reportChannelId = null }) {
  const { data, error } = await database
    .from('role_quotas')
    .upsert({ guild_id: guildId, role_id: roleId, period_days: periodDays, min_messages: minMessages, max_strikes: maxStrikes, notify_dm: notifyDm, report_channel_id: reportChannelId, period_started_at: new Date().toISOString() }, { onConflict: 'guild_id,role_id' })
    .select('*')
    .single();
  rulesCache.delete(String(guildId));
  if (error) throw error;
  // A new quota starts a new period: what was counted for the old one does not count for it (the strikes stay).
  await database.from('role_quota_members').update({ messages: 0 }).eq('guild_id', guildId).eq('role_id', roleId);
  return data;
}

async function removeRule(guildId, roleId) {
  const { data, error } = await database.from('role_quotas').delete().eq('guild_id', guildId).eq('role_id', roleId).select('role_id');
  rulesCache.delete(String(guildId));
  if (error) throw error;
  return data.length > 0;
}

/** The rules whose period is over (in any server): `period_started_at + period_days days <= now`. */
async function listDueRules() {
  const { rows } = await getPrimaryPool().query("select * from role_quotas where period_started_at + make_interval(days => period_days) <= now() order by period_started_at asc limit 200");
  return rows;
}

async function listMembers(guildId, roleId) {
  const { data, error } = await database.from('role_quota_members').select('*').eq('guild_id', guildId).eq('role_id', roleId);
  if (error) throw error;
  return data;
}

async function listMembersOfUser(guildId, userId) {
  const { data, error } = await database.from('role_quota_members').select('*').eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
  return data;
}

/** Adds the messages counted in memory: one statement for all of them (a member who has no row yet gets one, from before Petto looked). */
async function addMessages(entries) {
  if (!entries.length) return;
  await getPrimaryPool().query(
    `insert into role_quota_members (guild_id, role_id, user_id, messages)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::int[])
     on conflict (guild_id, role_id, user_id) do update set messages = role_quota_members.messages + excluded.messages`,
    [entries.map((e) => e.guildId), entries.map((e) => e.roleId), entries.map((e) => e.userId), entries.map((e) => e.count)],
  );
}

/** A member who was given the role: they are judged from the next period (`since`), with nothing counted yet. */
async function markNewHolder(guildId, roleId, userId, now = new Date()) {
  await getPrimaryPool().query(
    `insert into role_quota_members (guild_id, role_id, user_id, messages, strikes, since) values ($1, $2, $3, 0, 0, $4)
     on conflict (guild_id, role_id, user_id) do update set messages = 0, strikes = 0, since = excluded.since, last_result = null`,
    [guildId, roleId, userId, now.toISOString()],
  );
}

async function forgetHolder(guildId, roleId, userId) {
  const { error } = await database.from('role_quota_members').delete().eq('guild_id', guildId).eq('role_id', roleId).eq('user_id', userId);
  if (error) throw error;
}

/** Saves the result of closing a period for the members of a rule: `rows` are `{ userId, strikes, lastResult }` (the count goes back to zero and the period is not "new" any more). */
async function saveResults(guildId, roleId, rows) {
  if (!rows.length) return;
  await getPrimaryPool().query(
    `insert into role_quota_members (guild_id, role_id, user_id, messages, strikes, since, last_result)
       select $1, $2, u, 0, s, null, r from unnest($3::text[], $4::int[], $5::text[]) as v(u, s, r)
     on conflict (guild_id, role_id, user_id) do update set messages = 0, strikes = excluded.strikes, since = null, last_result = excluded.last_result`,
    [guildId, roleId, rows.map((row) => row.userId), rows.map((row) => row.strikes), rows.map((row) => row.lastResult)],
  );
}

async function forgetMembers(guildId, roleId, userIds) {
  if (!userIds.length) return;
  await getPrimaryPool().query('delete from role_quota_members where guild_id = $1 and role_id = $2 and user_id = any($3::text[])', [guildId, roleId, userIds]);
}

/** Closes a period: the next one starts where this one should have ended (so the days do not drift), and the counts of the result are kept for the dashboard. */
async function closePeriod(rule, { now = new Date(), met = 0, missed = 0, removed = 0 } = {}) {
  const periodMs = rule.period_days * 86_400_000;
  const started = new Date(rule.period_started_at).getTime();
  const steps = Math.max(1, Math.floor((now.getTime() - started) / periodMs));
  const nextStart = new Date(started + steps * periodMs).toISOString();
  const { error } = await database.from('role_quotas').update({ period_started_at: nextStart, last_run_at: now.toISOString(), last_met: met, last_missed: missed, last_removed: removed }).eq('guild_id', rule.guild_id).eq('role_id', rule.role_id);
  rulesCache.delete(String(rule.guild_id));
  if (error) throw error;
  return nextStart;
}

/** Excuses (or, with `until` null, stops excusing) a member in every one of `roleIds`: the periods that end before `until` do not count for them or against them. */
async function setExcuse(guildId, roleIds, userId, until) {
  if (!roleIds.length) return 0;
  await getPrimaryPool().query(
    `insert into role_quota_members (guild_id, role_id, user_id, excused_until) select $1, r, $2, $3 from unnest($4::text[]) as r
     on conflict (guild_id, role_id, user_id) do update set excused_until = excluded.excused_until`,
    [guildId, userId, until ? until.toISOString() : null, roleIds],
  );
  return roleIds.length;
}

module.exports = { listRules, upsertRule, removeRule, listDueRules, listMembers, listMembersOfUser, addMessages, markNewHolder, forgetHolder, saveResults, forgetMembers, closePeriod, setExcuse };
