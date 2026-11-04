const database = require('./database');
const { getPrimaryPool } = require('./postgres');
const { botDay } = require('../utils/botTime');

const SERVER_RANK_SIZE = 10;
const USER_RANK_SIZE = 10;
const METRICS = ['messages', 'reactions', 'voiceSeconds'];
const HISTORY_ID = 'history';
const HISTORY_DAYS = 400; // days kept in the `history` row
const BACKFILL_DAYS = 90; // how far back the servers and members of the days before the first snapshot are rebuilt
let membersSeed = require('../data/membersHistorySeed.json'); // the team's own records of the members before the bot counted them
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The messages, reactions and voice time of every server, all time, today (GMT-5) and in the last 7 days. */
async function readTotals() {
  const { rows } = await getPrimaryPool().query(`
    with d as (select (now() at time zone 'America/Bogota')::date as today)
    select
      coalesce(sum(messages), 0)::bigint as messages_all,
      coalesce(sum(reactions), 0)::bigint as reactions_all,
      coalesce(sum(voice_seconds), 0)::bigint as voice_all,
      coalesce(sum(messages) filter (where day = d.today), 0)::bigint as messages_today,
      coalesce(sum(reactions) filter (where day = d.today), 0)::bigint as reactions_today,
      coalesce(sum(voice_seconds) filter (where day = d.today), 0)::bigint as voice_today,
      coalesce(sum(messages) filter (where day > d.today - 7), 0)::bigint as messages_week,
      coalesce(sum(reactions) filter (where day > d.today - 7), 0)::bigint as reactions_week,
      coalesce(sum(voice_seconds) filter (where day > d.today - 7), 0)::bigint as voice_week,
      count(distinct guild_id)::int as guilds
    from activity_stats, d
  `);
  const r = rows[0];
  const period = (key) => ({ messages: Number(r[`messages_${key}`]), reactions: Number(r[`reactions_${key}`]), voiceSeconds: Number(r[`voice_${key}`]) });
  return { all: period('all'), today: period('today'), week: period('week'), guilds: r.guilds };
}

/** The all-time totals plus the baseline of what was counted before the outage that lost part of the counters (see `globalStatsBaseline` in config.js). */
function withBaseline(all, baseline = require('../config').globalStatsBaseline) {
  return {
    messages: all.messages + (baseline?.messages ?? 0),
    reactions: all.reactions + (baseline?.reactions ?? 0),
    voiceSeconds: all.voiceSeconds + (baseline?.voiceSeconds ?? 0),
  };
}

/** The servers that chose to be ranked, with their numbers all time and in the last 7 days. */
async function readRankedServers() {
  const { rows } = await getPrimaryPool().query(`
    with d as (select (now() at time zone 'America/Bogota')::date as today)
    select a.guild_id,
      sum(a.messages)::bigint as messages_all, sum(a.reactions)::bigint as reactions_all, sum(a.voice_seconds)::bigint as voice_all,
      coalesce(sum(a.messages) filter (where a.day > d.today - 7), 0)::bigint as messages_week,
      coalesce(sum(a.reactions) filter (where a.day > d.today - 7), 0)::bigint as reactions_week,
      coalesce(sum(a.voice_seconds) filter (where a.day > d.today - 7), 0)::bigint as voice_week
    from activity_stats a join guilds g on g.guild_id = a.guild_id, d
    where not g.global_stats_hidden
    group by a.guild_id
  `);
  return rows.map((r) => ({
    id: r.guild_id,
    all: { messages: Number(r.messages_all), reactions: Number(r.reactions_all), voiceSeconds: Number(r.voice_all) },
    week: { messages: Number(r.messages_week), reactions: Number(r.reactions_week), voiceSeconds: Number(r.voice_week) },
  }));
}

/** The top servers for each metric and period, with the name and icon that `describe(id)` gives (or null to leave one out). */
function buildRanking(servers, describe) {
  const ranking = {};
  for (const period of ['all', 'week']) {
    ranking[period] = {};
    for (const metric of METRICS) {
      ranking[period][metric] = servers
        .filter((server) => server[period][metric] > 0)
        .sort((a, b) => b[period][metric] - a[period][metric])
        .map((server) => ({ server, info: describe(server.id) }))
        .filter((entry) => entry.info)
        .slice(0, SERVER_RANK_SIZE)
        .map(({ server, info }) => ({ id: server.id, name: info.name, icon: info.icon ?? null, members: info.members ?? null, value: server[period][metric] }));
    }
  }
  return ranking;
}

/** How fast each number grows per second, from today so far, so the page can keep the counters moving between updates. */
function buildRates(today, now = new Date()) {
  const sinceMidnight = Math.max(900, (now.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 1000);
  const rate = (value) => Math.round((value / sinceMidnight) * 1000) / 1000;
  return { messages: rate(today.messages), reactions: rate(today.reactions), voiceSeconds: rate(today.voiceSeconds) };
}

async function saveRow(id, data) {
  const { error } = await database.from('global_stats').upsert({ id, data, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
}

async function saveSnapshot(data) {
  await saveRow('main', data);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The daily history (row `history`): one entry for each day in GMT-5, oldest first, the last one being today (in progress).
//   { days: [{ day, servers, members, messages, reactions, voiceSeconds, estimated? }], updatedAt }
// Messages, reactions and voice time are added up from `activity_stats` (all servers, like `totals`). Servers and members are stored by the
// bot itself, in this row: no table keeps them for each day, so each run sets today's from the live numbers and the earlier days stay as they
// were written. The days before the first stored one are rebuilt once from `guilds`, `guild_departures` and `member_flow` and marked `estimated`.
// ---------------------------------------------------------------------------------------------------------------------------------

/** `day` (YYYY-MM-DD) moved by `count` days. */
function dayShift(day, count) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

const countOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);

/** The row `history` as it was saved, or null when there is none yet. */
async function readHistory() {
  const { rows } = await getPrimaryPool().query(`select data from global_stats where id = '${HISTORY_ID}'`);
  return rows[0]?.data ?? null;
}

/** The messages, reactions and voice time of every server for each of the last days (the same table and filter as `readTotals`). */
async function readDailyActivity() {
  const { rows } = await getPrimaryPool().query(`
    with d as (select (now() at time zone 'America/Bogota')::date as today)
    select a.day::text as day, sum(a.messages)::bigint as messages, sum(a.reactions)::bigint as reactions, sum(a.voice_seconds)::bigint as voice_seconds
    from activity_stats a, d
    where a.day > d.today - ${HISTORY_DAYS}
    group by a.day
    order by a.day
  `);
  return rows.map((r) => ({ day: r.day, messages: Number(r.messages), reactions: Number(r.reactions), voiceSeconds: Number(r.voice_seconds) }));
}

/** What the database knows about how the servers and members grew: when each server was first seen, when it left, and the net joins of each day. */
async function readGrowthSources(sinceDay) {
  const pool = getPrimaryPool();
  const [guilds, flow] = await Promise.all([
    pool.query(`
      select g.guild_id,
        (g.created_at at time zone 'America/Bogota')::date::text as created_day,
        (d.left_at at time zone 'America/Bogota')::date::text as left_day,
        s.member_count
      from guilds g
      left join guild_departures d on d.guild_id = g.guild_id
      left join discord_guild_snapshots s on s.guild_id = g.guild_id
    `),
    pool.query('select guild_id, day::text as day, (joins - leaves)::int as net from member_flow where day > $1::date and joins <> leaves', [sinceDay]),
  ]);
  return { guildRows: guilds.rows, flowRows: flow.rows };
}

/** Maps a stored row to `day -> entry`, dropping anything that is not a day. */
function storedDays(row) {
  const days = new Map();
  for (const entry of Array.isArray(row?.days) ? row.days : []) {
    if (entry && typeof entry.day === 'string' && DAY_PATTERN.test(entry.day)) days.set(entry.day, entry);
  }
  return days;
}

/**
 * The days (before `today`) whose servers and members have to be rebuilt. Nothing stored yet: every day back to `seedFrom` (the first day of the
 * records of the team, when there are) or `BACKFILL_DAYS` back, whichever is older, never more than the 400 days of the row. Something stored: only
 * the holes between the stored days (the bot was off, or the load guard paused the job), at most `BACKFILL_DAYS` back. Days before the first stored
 * one are never asked again.
 */
function daysToRebuild(stored, today, seedFrom = null) {
  const limit = dayShift(today, -BACKFILL_DAYS);
  const windowStart = dayShift(today, -(HISTORY_DAYS - 1));
  let from;
  if (stored.size) { const first = [...stored.keys()].sort()[0]; from = first < limit ? limit : first; }
  else { from = seedFrom && seedFrom < limit ? seedFrom : limit; if (from < windowStart) from = windowStart; }
  const days = [];
  for (let day = from; day < today; day = dayShift(day, 1)) if (!stored.has(day)) days.push(day);
  return days;
}

/**
 * The members of each day from the records of the team (`membersSeed`, see `data/membersHistorySeed.json`). `baseline` are dated anchors: a straight
 * line for each day between two of them (two anchors on consecutive days make a jump), and from the last one a straight line to today's live total.
 * `spikes` are totals that replace the baseline on their recorded day and the next ones up to `spikeDays` (the bot was down, so they were not counted
 * day by day). Nothing is built before the first anchor. Returns `day -> members`
 * from the first anchor to yesterday (never today: today is always the live value), or an empty map when there is nothing to build from.
 */
function seedMembers({ seed = membersSeed, today, live }) {
  const valid = (list, key) => (Array.isArray(list) ? list : []).filter((item) => item && DAY_PATTERN.test(item.day) && item.day < today && Number.isFinite(item[key]) && item[key] >= 0).sort((a, b) => (a.day < b.day ? -1 : 1));
  // `recorded` are exact counts the team kept for recent days: the straight line passes through them like through the anchors of `baseline`.
  const anchors = [...valid(seed?.baseline, 'members'), ...valid(seed?.recorded, 'members')].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  if (!anchors.length || !Number.isFinite(live) || live <= 0) return new Map();
  const nodes = [...anchors, { day: today, members: live }];
  const out = new Map();
  const known = new Set(); // the days of the spikes: dates and totals the team recorded, so they are not estimates
  for (let n = 0; n < nodes.length - 1; n += 1) {
    const [from, to] = [nodes[n], nodes[n + 1]];
    const length = (Date.parse(`${to.day}T00:00:00Z`) - Date.parse(`${from.day}T00:00:00Z`)) / 86_400_000;
    for (let k = 0; k < length; k += 1) out.set(dayShift(from.day, k), Math.round(from.members + ((to.members - from.members) * k) / length));
  }
  const length = Number.isInteger(seed?.spikeDays) && seed.spikeDays >= 1 ? seed.spikeDays : 1;
  for (const spike of valid(seed?.spikes, 'members')) {
    for (let k = 0; k < length; k += 1) {
      const day = dayShift(spike.day, k);
      if (day >= anchors[0].day && day < today) { out.set(day, spike.members); known.add(day); }
    }
  }
  out.known = known;
  return out;
}

/**
 * Servers and members at the end of each of `days`, rebuilt from what is stored. Servers: the ones Petto is in, whose row was created by then, plus
 * the ones it left that are not yet deleted (until the day they left). Members: for each of those servers, today's count (from the bot's cache, or
 * the last snapshot of a server it left) minus the joins less the leaves of the days after. Returns `day -> { servers, members }`; empty when no
 * server is known. It is an estimate: servers deleted after they left are unknown, and `member_flow` only counts since each server's stats started.
 */
function estimateGrowth({ guildRows, flowRows, cache, days, today }) {
  const estimates = new Map();
  if (!days.length) return estimates;
  const guilds = [];
  for (const row of guildRows) {
    const live = cache.get(row.guild_id);
    if (live) guilds.push({ id: row.guild_id, created: row.created_day, left: null, members: Number(live.memberCount) || 0 });
    else if (row.left_day) guilds.push({ id: row.guild_id, created: row.created_day, left: row.left_day, members: Number(row.member_count) || 0 });
  }
  if (!guilds.length) return estimates;
  const flows = new Map();
  for (const row of flowRows) {
    if (!flows.has(row.guild_id)) flows.set(row.guild_id, new Map());
    flows.get(row.guild_id).set(row.day, Number(row.net) || 0);
  }
  const first = days[0];
  const wanted = new Set(days);
  const totals = new Map(days.map((day) => [day, { servers: 0, members: 0 }]));
  for (const guild of guilds) {
    const net = flows.get(guild.id) ?? new Map();
    let after = net.get(today) ?? 0; // the net of the days after the one being looked at
    for (let day = dayShift(today, -1); day >= first; day = dayShift(day, -1)) {
      if (wanted.has(day) && guild.created <= day && (!guild.left || guild.left > day)) {
        const entry = totals.get(day);
        entry.servers += 1;
        entry.members += Math.max(0, guild.members - after);
      }
      after += net.get(day) ?? 0;
    }
  }
  const earliest = guilds.map((guild) => guild.created).sort()[0];
  for (const day of days) if (day >= earliest) estimates.set(day, totals.get(day));
  return estimates;
}

/**
 * The `history` row. `previous` is the row as saved before, `activity` the rows of `readDailyActivity`, `todayTotals` the numbers of today of
 * `readTotals` (so today's entry is exactly `totals.today`), `live` the servers and members now, and `estimates` the rebuilt days (only used for
 * a day that has no stored entry), `seed` the members of each day from the records of the team (`seedMembers`, which win over `estimates`
 * for the members). A day that was stored keeps its servers and members as they were written; today's are the live ones.
 */
function buildHistory({ now = new Date(), previous, activity, todayTotals, live, estimates = new Map(), seed = new Map(), solidFrom = null }) {
  const today = botDay(now);
  const windowStart = dayShift(today, -(HISTORY_DAYS - 1));
  const stored = storedDays(previous);
  const perDay = new Map(activity.map((entry) => [entry.day, entry]));
  const present = new Set([today, ...stored.keys(), ...perDay.keys(), ...estimates.keys(), ...seed.keys()]);
  const first = [...present].filter((day) => day >= windowStart && day <= today).sort()[0];
  const days = [];
  for (let day = first; day <= today; day = dayShift(day, 1)) {
    const numbers = day === today ? todayTotals : (perDay.get(day) ?? {});
    const entry = { day, servers: null, members: null, messages: numbers.messages ?? 0, reactions: numbers.reactions ?? 0, voiceSeconds: numbers.voiceSeconds ?? 0 };
    const keep = stored.get(day);
    if (day === today) {
      entry.servers = live.servers; entry.members = live.members;
    } else if (keep) {
      entry.servers = countOrNull(keep.servers); entry.members = countOrNull(keep.members);
      if (keep.estimated === true) entry.estimated = true;
    } else if (seed.has(day) || estimates.has(day)) {
      // The records of the team decide the members of the days they cover; the servers can only come from the rebuilt ones (else null).
      entry.servers = estimates.get(day)?.servers ?? null;
      entry.members = seed.has(day) ? seed.get(day) : estimates.get(day).members;
      // From the first exact count the team kept (`recorded`) to today the days are real counts, not estimates: the line is drawn solid.
      // The days of a spike (a date and a total the team recorded) are known too: only the stretches between them are estimates.
      if (!(seed.has(day) && ((solidFrom && day >= solidFrom) || seed.known?.has(day)))) entry.estimated = true;
    }
    days.push(entry);
  }
  return { days: days.slice(-HISTORY_DAYS), updatedAt: now.toISOString() };
}

/**
 * Reads the previous row, rebuilds the days it lacks (the first time, or after holes) and saves the new `history` row. Nothing is written when the
 * bot has no servers loaded (it has not finished starting). Returns the row that was saved, or null.
 */
async function refreshHistory({ now = new Date(), totalsToday, servers, members, cache }) {
  if (!servers) return null;
  const today = botDay(now);
  const previous = await readHistory();
  const stored = storedDays(previous);
  // The records of the team only fill the days before the first snapshot the bot stored itself: with one stored, they are not used.
  const seed = stored.size || !membersSeed ? new Map() : seedMembers({ seed: membersSeed, today, live: members });
  const missing = daysToRebuild(stored, today, [...seed.keys()].sort()[0] ?? null);
  const flowDays = missing.filter((day) => day >= dayShift(today, -BACKFILL_DAYS)); // the flow of members only rebuilds the last 90 days
  const estimates = flowDays.length ? estimateGrowth({ ...(await readGrowthSources(flowDays[0])), cache, days: flowDays, today }) : new Map();
  const activity = await readDailyActivity();
  const solidFrom = [...(Array.isArray(membersSeed?.recorded) ? membersSeed.recorded : [])].map((item) => item?.day).filter((day) => DAY_PATTERN.test(day ?? '')).sort()[0] ?? null;
  const data = buildHistory({ now, previous, activity, todayTotals: totalsToday, live: { servers, members }, estimates, seed, solidFrom });
  await saveRow(HISTORY_ID, data);
  return data;
}

/** Replaces the records of the team (the file `data/membersHistorySeed.json`) with `seed`, or with nothing (for the checks); returns the previous ones. */
function setMembersSeed(seed) {
  const previous = membersSeed;
  membersSeed = seed;
  return previous;
}

/** The members with the most messages and the most voice time over every server, leaving out who hid themselves. */
async function readRankedUsers() {
  const pool = getPrimaryPool();
  const top = (column) => pool.query(`
    select l.user_id, sum(l.messages)::bigint as messages, (sum(l.vc_minutes) * 60)::bigint as voice_seconds
    from level_users l
    where not exists (select 1 from global_stats_hidden_users h where h.user_id = l.user_id)
    group by l.user_id
    order by ${column} desc
    limit ${USER_RANK_SIZE + 10}
  `);
  const [byMessages, byVoice] = await Promise.all([top('messages'), top('voice_seconds')]);
  const users = new Map();
  for (const r of [...byMessages.rows, ...byVoice.rows]) users.set(r.user_id, { id: r.user_id, messages: Number(r.messages), voiceSeconds: Number(r.voice_seconds) });
  return [...users.values()];
}

/** The top members for messages and for voice time; `describe(id)` gives the name and avatar, or null to leave one out. */
function buildUserRanking(users, describe) {
  const ranking = {};
  for (const metric of ['messages', 'voiceSeconds']) {
    ranking[metric] = users
      .filter((user) => user[metric] > 0)
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, USER_RANK_SIZE + 5) // a few more, in case some cannot be described
      .map((user) => ({ user, info: describe(user.id) }))
      .filter((entry) => entry.info)
      .slice(0, USER_RANK_SIZE)
      .map(({ user, info }) => ({ id: user.id, name: info.name, avatar: info.avatar ?? null, value: user[metric] }));
  }
  return ranking;
}

async function setUserVisible(userId, visible) {
  const pool = getPrimaryPool();
  if (visible) await pool.query('delete from global_stats_hidden_users where user_id = $1', [String(userId)]);
  else await pool.query('insert into global_stats_hidden_users (user_id) values ($1) on conflict do nothing', [String(userId)]);
}

async function isUserVisible(userId) {
  const { rows } = await getPrimaryPool().query('select 1 from global_stats_hidden_users where user_id = $1', [String(userId)]);
  return rows.length === 0;
}

module.exports = { withBaseline, seedMembers, setMembersSeed, HISTORY_DAYS, BACKFILL_DAYS, dayShift, storedDays, daysToRebuild, estimateGrowth, buildHistory, refreshHistory, readHistory, readDailyActivity, readGrowthSources, SERVER_RANK_SIZE, USER_RANK_SIZE, readTotals, readRankedServers, buildRanking, readRankedUsers, buildUserRanking, setUserVisible, isUserVisible, buildRates, saveSnapshot };
