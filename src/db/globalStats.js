const database = require('./database');
const { getPrimaryPool } = require('./postgres');

const SERVER_RANK_SIZE = 3;
const USER_RANK_SIZE = 10;
const METRICS = ['messages', 'reactions', 'voiceSeconds'];

/** The messages, reactions and voice time of every server, all time, today (UTC) and in the last 7 days. */
async function readTotals() {
  const { rows } = await getPrimaryPool().query(`
    with d as (select (now() at time zone 'utc')::date as today)
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

/** The servers that chose to be ranked, with their numbers all time and in the last 7 days. */
async function readRankedServers() {
  const { rows } = await getPrimaryPool().query(`
    with d as (select (now() at time zone 'utc')::date as today)
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
        .map(({ server, info }) => ({ id: server.id, name: info.name, icon: info.icon ?? null, value: server[period][metric] }));
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

async function saveSnapshot(data) {
  const { error } = await database.from('global_stats').upsert({ id: 'main', data, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
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

module.exports = { SERVER_RANK_SIZE, USER_RANK_SIZE, readTotals, readRankedServers, buildRanking, readRankedUsers, buildUserRanking, setUserVisible, isUserVisible, buildRates, saveSnapshot };
