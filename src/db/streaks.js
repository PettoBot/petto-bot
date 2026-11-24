"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.DEFAULT_MILESTONES = void 0;
exports.getConfig = getConfig;
exports.guildsWithRewards = guildsWithRewards;
exports.daysOf = daysOf;
exports.daysOfMany = daysOfMany;
exports.busiestMembers = busiestMembers;
exports.recentMembers = recentMembers;
exports.plansOf = plansOf;
exports.totalsOf = totalsOf;
exports.guildsOf = guildsOf;
exports.rolesOf = rolesOf;
exports.awardsOf = awardsOf;
exports.recordAward = recordAward;
exports.optedOut = optedOut;
exports.setOptOut = setOptOut;
exports.claimNotice = claimNotice;
exports.pruneNotices = pruneNotices;
const { getPrimaryPool } = require('./postgres');
exports.DEFAULT_MILESTONES = [3, 7, 14, 30, 60, 100, 365];
exports.DEFAULT_CONFIG = { enabled: true, mode: 'any', minMessages: 1, minVoiceMinutes: 0, announceChannelId: null, milestones: exports.DEFAULT_MILESTONES, guildFreezes: 0, resetAt: null, graceMinutes: 0, dmReminder: false, dmLost: false, nicknameEnabled: false, nicknameEmoji: '🔥', countingSince: null };
const MODES = ['messages', 'voice', 'any', 'both'];
function toConfig(row) {
    return {
        enabled: Boolean(row.enabled), mode: MODES.includes(row.mode) ? row.mode : 'any', minMessages: Number(row.min_messages), minVoiceMinutes: Number(row.min_voice_minutes),
        announceChannelId: row.announce_channel_id ? String(row.announce_channel_id) : null,
        milestones: Array.isArray(row.milestones) ? row.milestones.map(Number).filter((n) => n >= 1 && n <= 3650).sort((a, b) => a - b) : exports.DEFAULT_MILESTONES,
        guildFreezes: Number(row.guild_freezes ?? 0), resetAt: row.reset_at ? String(row.reset_at).slice(0, 10) : null,
        graceMinutes: Number(row.grace_minutes ?? 0), dmReminder: Boolean(row.dm_reminder), dmLost: Boolean(row.dm_lost), nicknameEnabled: Boolean(row.nickname_enabled), nicknameEmoji: String(row.nickname_emoji || '🔥'),
        countingSince: row.counting_since ? String(row.counting_since).slice(0, 10) : null,
    };
}
const COLUMNS = `enabled, mode, min_messages, min_voice_minutes, announce_channel_id, milestones, guild_freezes, to_char(reset_at, 'YYYY-MM-DD') as reset_at, grace_minutes, dm_reminder, dm_lost, nickname_enabled, nickname_emoji, to_char(counting_since, 'YYYY-MM-DD') as counting_since`;
async function getConfig(guildId) {
    const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from streak_config where guild_id = $1`, [guildId]);
    return rows[0] ? toConfig(rows[0]) : { ...exports.DEFAULT_CONFIG, milestones: [...exports.DEFAULT_MILESTONES] };
}
/** The servers that have something to do on their own: an announcement channel, reward roles, the reminders by DM or the streak in the nickname (and the streaks are on). */
async function guildsWithRewards() {
    const { rows } = await getPrimaryPool().query(`select c.guild_id from streak_config c where c.enabled and (c.announce_channel_id is not null or c.dm_reminder or c.dm_lost or c.nickname_enabled or exists (select 1 from streak_roles r where r.guild_id = c.guild_id))`);
    return rows.map((row) => String(row.guild_id));
}
const mapDays = (rows) => rows.map((row) => ({ day: String(row.day), messages: Number(row.messages), voiceSeconds: Number(row.voice_seconds) }));
// The days of a person: what activity_members says, except that from the day the server started to filter what counts (`counting_since`) the messages are the ones of streak_days
// (a day with only a counted reaction has a row there and none in activity_members, hence the full join). The voice time always comes from activity_members.
const FLOOR = `greatest(current_date - 400, coalesce($RESET::date, date '1970-01-01'))`;
const daysSql = (guild, users, reset, select) => `
  with since as (select counting_since as day from streak_config where guild_id = ${guild}),
  a as (select user_id, day, messages, voice_seconds from activity_members where guild_id = ${guild} and ${users} and day >= ${FLOOR.replace('$RESET', reset)}),
  s as (select user_id, day, messages from streak_days where guild_id = ${guild} and ${users} and day >= ${FLOOR.replace('$RESET', reset)})
  select ${select}
  from a full join s on a.user_id = s.user_id and a.day = s.day
  where a.day is not null or s.day >= (select day from since)
  order by 1, 2`;
const dayColumns = `to_char(coalesce(a.day, s.day), 'YYYY-MM-DD') as day,
    case when (select day from since) is not null and coalesce(a.day, s.day) >= (select day from since) then coalesce(s.messages, 0) else coalesce(a.messages, 0) end as messages,
    coalesce(a.voice_seconds, 0) as voice_seconds`;
/** The days of a person in a server over the last 400 days (after the last reset of the server). */
async function daysOf(guildId, userId, resetAt = null) {
    const { rows } = await getPrimaryPool().query(daysSql('$1', 'user_id = $2', '$3', `${dayColumns}`).replace('order by 1, 2', 'order by 1'), [guildId, userId, resetAt]);
    return mapDays(rows);
}
/** The days of many people at once: user id -> days. */
async function daysOfMany(guildId, userIds, resetAt = null) {
    const out = new Map();
    if (!userIds.length)
        return out;
    const { rows } = await getPrimaryPool().query(daysSql('$1', 'user_id = any($2::text[])', '$3', `coalesce(a.user_id, s.user_id) as user_id, ${dayColumns}`).replace('order by 1, 2', 'order by 2'), [guildId, userIds, resetAt]);
    for (const row of rows) {
        const list = out.get(String(row.user_id)) ?? [];
        list.push(...mapDays([row]));
        out.set(String(row.user_id), list);
    }
    return out;
}
/** The members with the most active days in a server (the candidates of the board): at most `limit`. */
async function busiestMembers(guildId, resetAt, limit = 1000) {
    const { rows } = await getPrimaryPool().query(`select user_id from (select user_id, day from activity_members where guild_id = $1 union select user_id, day from streak_days where guild_id = $1) d where day >= greatest(current_date - 400, coalesce($2::date, date '1970-01-01')) group by user_id order by count(*) desc limit $3`, [guildId, resetAt, limit]);
    return rows.map((row) => String(row.user_id));
}
/** The members who did something today or yesterday (UTC): the only ones whose streak can have moved. */
async function recentMembers(guildId, limit = 5000, sinceDays = 1) {
    const { rows } = await getPrimaryPool().query(`select user_id from (select user_id, day from activity_members where guild_id = $1 union select user_id, day from streak_days where guild_id = $1) d where day >= current_date - $3::int group by user_id limit $2`, [guildId, limit, sinceDays]);
    return rows.map((row) => String(row.user_id));
}
/** The active plans of many people: user id -> plan. */
async function plansOf(userIds) {
    const out = new Map();
    if (!userIds.length)
        return out;
    const { rows } = await getPrimaryPool().query(`select user_id, plan from user_plans where user_id = any($1::text[]) and (ends_at is null or ends_at > now())`, [userIds]);
    for (const row of rows)
        out.set(String(row.user_id), String(row.plan));
    return out;
}
/** What a person did in every server: messages and seconds in voice (activity_members already leaves out who asked not to be counted). */
async function totalsOf(userId) {
    const { rows } = await getPrimaryPool().query(`select coalesce(sum(messages), 0) as messages, coalesce(sum(voice_seconds), 0) as voice from activity_members where user_id = $1`, [userId]);
    return { messages: Number(rows[0]?.messages ?? 0), voiceSeconds: Number(rows[0]?.voice ?? 0) };
}
/** The servers where a person has been active, the latest first (at most 10). */
async function guildsOf(userId) {
    const { rows } = await getPrimaryPool().query(`select guild_id from activity_members where user_id = $1 group by guild_id order by max(day) desc limit 10`, [userId]);
    return rows.map((row) => String(row.guild_id));
}
/** The reward roles of a server: days -> role, sorted by days. */
async function rolesOf(guildId) {
    const { rows } = await getPrimaryPool().query(`select days, role_id from streak_roles where guild_id = $1 order by days`, [guildId]);
    return rows.map((row) => ({ days: Number(row.days), roleId: String(row.role_id) }));
}
/** What was already given or announced to the members: user id -> days. */
async function awardsOf(guildId, userIds) {
    const out = new Map();
    if (!userIds.length)
        return out;
    const { rows } = await getPrimaryPool().query(`select user_id, days from streak_awards where guild_id = $1 and user_id = any($2::text[])`, [guildId, userIds]);
    for (const row of rows) {
        const set = out.get(String(row.user_id)) ?? new Set();
        set.add(Number(row.days));
        out.set(String(row.user_id), set);
    }
    return out;
}
/** Remembers that a number of days was given or announced to a member. True when it was new (the same look never does it twice). */
async function recordAward(guildId, userId, days) {
    const { rowCount } = await getPrimaryPool().query(`insert into streak_awards (guild_id, user_id, days) values ($1, $2, $3) on conflict do nothing`, [guildId, userId, days]);
    return (rowCount ?? 0) > 0;
}
/** Who of these people asked not to get the messages of the streaks and the streak in the nickname. */
async function optedOut(userIds) {
    if (!userIds.length)
        return new Set();
    const { rows } = await getPrimaryPool().query(`select user_id from streak_optout where user_id = any($1::text[])`, [userIds]);
    return new Set(rows.map((row) => String(row.user_id)));
}
/** A person turns the messages and the nickname of the streaks off (`out` true) or on again. */
async function setOptOut(userId, out) {
    if (out)
        await getPrimaryPool().query(`insert into streak_optout (user_id) values ($1) on conflict do nothing`, [userId]);
    else
        await getPrimaryPool().query(`delete from streak_optout where user_id = $1`, [userId]);
}
/** Claims a message of a day for a member (a reminder or a lost streak): true the first time, so it is sent once a day. */
async function claimNotice(guildId, userId, kind, day) {
    const { rowCount } = await getPrimaryPool().query(`insert into streak_notices (guild_id, user_id, kind, day) values ($1, $2, $3, $4::date) on conflict do nothing`, [guildId, userId, kind, day]);
    return (rowCount ?? 0) > 0;
}
/** The notices older than a week are deleted (nobody looks at them again). */
async function pruneNotices() {
    await getPrimaryPool().query(`delete from streak_notices where day < current_date - 7`);
}
