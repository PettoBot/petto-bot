// Forum support: the setups of a server (one per forum channel) and the index of its posts. The rules of what a setup may hold are in
// utils/forumConfig.js; this file only reads and writes. Writes that run on every message or every minute use the pool directly, so they
// never raise the "settings changed" stamp the dashboard watches (see utils/dashboardVersion.js).
const database = require('./database');
const { getPrimaryPool } = require('./postgres');

const gid = (guildId) => String(guildId);
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const OPEN = ['open', 'solved'];

// ── setups ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function listSetups(guildId) {
  const { data, error } = await database.from('forum_setups').select('*').eq('guild_id', gid(guildId)).order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** A setup by its number (`2`) or its name (`support`); null when the server has none like it. */
async function getSetup(guildId, ref) {
  const text = String(ref ?? '').trim().toLowerCase();
  if (!text) return null;
  let query = database.from('forum_setups').select('*').eq('guild_id', gid(guildId));
  if (/^\d{1,15}$/.test(text)) query = query.eq('id', Number(text));
  else if (NAME.test(text)) query = query.eq('name', text);
  else return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function getSetupById(id) {
  if (!/^\d{1,15}$/.test(String(id ?? ''))) return null;
  const { data, error } = await database.from('forum_setups').select('*').eq('id', Number(id)).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** The setup of a forum channel (a channel id belongs to one server, so the server is only a second check). */
async function getSetupByForum(guildId, forumChannelId) {
  if (!forumChannelId) return null;
  const { data, error } = await database.from('forum_setups').select('*').eq('guild_id', gid(guildId)).eq('forum_channel_id', String(forumChannelId)).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function countSetups(guildId) {
  const { count, error } = await database.from('forum_setups').select('id', { count: 'exact', head: true }).eq('guild_id', gid(guildId));
  if (error) throw error;
  return count ?? 0;
}

async function createSetup(guildId, row) {
  const { data, error } = await database.from('forum_setups').insert({ ...row, guild_id: gid(guildId) }).select('*').single();
  if (error) throw error;
  return data;
}

async function updateSetup(guildId, id, changes) {
  const { data, error } = await database.from('forum_setups').update({ ...changes, updated_at: new Date().toISOString() }).eq('guild_id', gid(guildId)).eq('id', Number(id)).select('*').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function deleteSetup(guildId, id) {
  const { error } = await database.from('forum_setups').delete().eq('guild_id', gid(guildId)).eq('id', Number(id));
  if (error) throw error;
}

// ── posts ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function getPost(threadId) {
  if (!threadId) return null;
  const { data, error } = await database.from('forum_posts').select('*').eq('thread_id', String(threadId)).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Starts to keep a post (or updates what is known of it when it is already kept). */
async function upsertPost(row) {
  const { data, error } = await database.from('forum_posts').upsert({ ...row, guild_id: gid(row.guild_id), thread_id: String(row.thread_id) }, { onConflict: 'thread_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function updatePost(threadId, changes) {
  const { data, error } = await database.from('forum_posts').update(changes).eq('thread_id', String(threadId)).select('*').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function deletePost(threadId) {
  const { error } = await database.from('forum_posts').delete().eq('thread_id', String(threadId));
  if (error) throw error;
}

/** The open posts (open or solved) of a member in a setup, newest first, with when the last one was opened (for the wait between two). */
async function memberState(setupId, authorId) {
  const { rows } = await getPrimaryPool().query(
    `select thread_id, status, opened_at, (select max(opened_at) from forum_posts where setup_id = $1 and author_id = $2) as last_opened_at
       from forum_posts where setup_id = $1 and author_id = $2 and status = any($3::text[]) order by opened_at desc limit 100`,
    [Number(setupId), String(authorId), OPEN],
  );
  if (rows.length) return { open: rows, lastOpenedAt: rows[0].last_opened_at };
  const { rows: last } = await getPrimaryPool().query('select max(opened_at) as last_opened_at from forum_posts where setup_id = $1 and author_id = $2', [Number(setupId), String(authorId)]);
  return { open: [], lastOpenedAt: last[0]?.last_opened_at ?? null };
}

/** A page of the posts of a server: `status` is one state, `open` (open and solved) or null for all; `setupId` narrows to one setup. */
async function listPosts(guildId, { status = null, setupId = null, authorId = null, limit = 25, offset = 0 } = {}) {
  const params = [gid(guildId)];
  const where = ['guild_id = $1']; // i18n-ignore: SQL or log text
  if (status === 'open') { params.push(OPEN); where.push(`status = any($${params.length}::text[])`); } // i18n-ignore: SQL or log text
  else if (status) { params.push(String(status)); where.push(`status = $${params.length}`); }
  if (setupId) { params.push(Number(setupId)); where.push(`setup_id = $${params.length}`); } // i18n-ignore: SQL or log text
  if (authorId) { params.push(String(authorId)); where.push(`author_id = $${params.length}`); } // i18n-ignore: SQL or log text
  params.push(Math.min(200, Math.max(1, Number(limit) || 25)), Math.max(0, Number(offset) || 0));
  const { rows } = await getPrimaryPool().query(`select * from forum_posts where ${where.join(' and ')} order by opened_at desc limit $${params.length - 1} offset $${params.length}`, params);
  return rows;
}

async function countPosts(guildId, { status = null, setupId = null } = {}) {
  const params = [gid(guildId)];
  const where = ['guild_id = $1']; // i18n-ignore: SQL or log text
  if (status === 'open') { params.push(OPEN); where.push(`status = any($${params.length}::text[])`); } // i18n-ignore: SQL or log text
  else if (status) { params.push(String(status)); where.push(`status = $${params.length}`); }
  if (setupId) { params.push(Number(setupId)); where.push(`setup_id = $${params.length}`); } // i18n-ignore: SQL or log text
  const { rows } = await getPrimaryPool().query(`select count(*)::int as n from forum_posts where ${where.join(' and ')}`, params);
  return rows[0]?.n ?? 0;
}

/**
 * A message was written in a post: the time of the last one is kept. At most one write every `everyMs` per post (the condition is in the
 * query, so it holds across restarts and several bots too), and only for posts that are still alive. True when a row changed.
 */
async function touchActivity(threadId, everyMs = 5 * 60_000) {
  const { rowCount } = await getPrimaryPool().query(
    `update forum_posts set last_activity_at = now() where thread_id = $1 and status = any($2::text[]) and last_activity_at < now() - ($3::int * interval '1 millisecond')`,
    [String(threadId), OPEN, Math.max(0, Math.trunc(everyMs))],
  );
  return rowCount > 0;
}

/** Changes the state of a post only when it is in one of `from` (so two staff members pressing at once do it once). Null when it was not. */
async function transition(threadId, from, changes) {
  const keys = Object.keys(changes);
  const sets = keys.map((key, index) => `${key} = $${index + 3}`);
  const { rows } = await getPrimaryPool().query(
    `update forum_posts set ${sets.join(', ')} where thread_id = $1 and status = any($2::text[]) returning *`,
    [String(threadId), from, ...keys.map((key) => changes[key])],
  );
  return rows[0] ?? null;
}

// ── what the job asks (each one reads an index and takes a few rows) ─────────────────────────────────────────────────────

/** Open posts with nothing written for the days their setup chose: `{ post, setup }` rows, the quietest first. */
async function dueInactive(limit = 25) {
  const { rows } = await getPrimaryPool().query(
    `select p.*, s.inactive_action as action from forum_posts p join forum_setups s on s.id = p.setup_id
      where p.status = any($1::text[]) and s.inactive_days > 0 and p.last_activity_at < now() - (s.inactive_days * interval '1 day')
      order by p.last_activity_at asc limit $2`,
    [OPEN, limit],
  );
  return rows;
}

/** Solved posts that have waited the hours their setup chose to be locked or closed. */
async function dueSolved(limit = 25) {
  const { rows } = await getPrimaryPool().query(
    `select p.*, s.solved_action as action from forum_posts p join forum_setups s on s.id = p.setup_id
      where p.status = 'solved' and s.solved_action <> 'none' and p.solved_at < now() - (s.solved_delay_hours * interval '1 hour')
      order by p.solved_at asc limit $1`,
    [limit],
  );
  return rows;
}

/** Posts whose time to get a tag is over. */
async function dueTag(limit = 25) {
  const { rows } = await getPrimaryPool().query(
    `select * from forum_posts where tag_deadline_at is not null and tag_deadline_at <= now() and status = 'open' order by tag_deadline_at asc limit $1`,
    [limit],
  );
  return rows;
}

module.exports = {
  NAME, OPEN,
  listSetups, getSetup, getSetupById, getSetupByForum, countSetups, createSetup, updateSetup, deleteSetup,
  getPost, upsertPost, updatePost, deletePost, memberState, listPosts, countPosts, touchActivity, transition,
  dueInactive, dueSolved, dueTag,
};
