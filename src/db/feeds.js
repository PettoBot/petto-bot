const database = require('./database');
const { ensureGuild } = require('./guilds');

const COLUMNS = 'id,number,guild_id,platform,account_id,account_name,account_avatar,account_url,channel_id,types,message,ping_roles,ping_everyone,options,filters,enabled,ready,failures,last_sent_at,last_error,last_error_at,created_by,created_at';
const SEEN_KEEP_DAYS = 60;

async function listForGuild(guildId) {
  const { data, error } = await database.from('feeds').select(COLUMNS).eq('guild_id', guildId).order('number', { ascending: true }).limit(500);
  if (error) throw error;
  return data ?? [];
}

/** How many feeds a server has: all of them, or those of one platform (the limits are for each platform). */
async function countForGuild(guildId, platform = null) {
  let query = database.from('feeds').select('id', { count: 'exact', head: true }).eq('guild_id', guildId);
  if (platform) query = query.eq('platform', platform);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function get(guildId, id) {
  const { data, error } = await database.from('feeds').select(COLUMNS).eq('guild_id', guildId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** A feed by the number its server sees (1, 2, 3...), or null. */
async function getByNumber(guildId, number) {
  const { data, error } = await database.from('feeds').select(COLUMNS).eq('guild_id', guildId).eq('number', number).maybeSingle();
  if (error) throw error;
  return data;
}

/** Every feed that is on, read from the database (one row per account followed, in pages). */
async function readEnabled() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await database.from('feeds').select(COLUMNS).eq('enabled', true).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

// The job asks for the feeds every minute: with many thousands of them that is a lot to read again and again, so the list is kept in memory. Every
// change made here (a feed made, changed, turned off or deleted) is applied to the kept list at once; a full read every few minutes also brings in
// what another process or a person changed in the database.
const KEEP_LIST_MS = 5 * 60_000;
let kept = null; // { rows: Map(id -> row), at }

/** Every feed that is on, for the job. */
async function listEnabled({ now = Date.now() } = {}) {
  if (kept && now - kept.at < KEEP_LIST_MS) return [...kept.rows.values()];
  const rows = await readEnabled();
  kept = { rows: new Map(rows.map((row) => [row.id, row])), at: now };
  return rows;
}

const forgetList = () => { kept = null; }; // for the checks, and for whoever writes to the table by hand
const keepRow = (row) => { if (!kept || !row) return; if (row.enabled) kept.rows.set(row.id, row); else kept.rows.delete(row.id); };

async function create(row) {
  await ensureGuild(row.guild_id);
  const { data, error } = await database.from('feeds').insert(row).select(COLUMNS).single();
  if (error) throw error;
  keepRow(data);
  return data;
}

async function update(guildId, id, patch) {
  const { data, error } = await database.from('feeds').update(patch).eq('guild_id', guildId).eq('id', id).select(COLUMNS).maybeSingle();
  if (error) throw error;
  keepRow(data);
  return data;
}

async function remove(guildId, id) {
  const { data, error } = await database.from('feeds').delete().eq('guild_id', guildId).eq('id', id).select('id');
  if (error) throw error;
  if (kept) kept.rows.delete(Number(id));
  return (data ?? []).length > 0;
}

/** For some feeds and some items: the pairs already posted, as `feedId:itemId`. */
async function seenAmong(feedIds, itemIds) {
  const seen = new Set();
  if (!feedIds.length || !itemIds.length) return seen;
  for (let i = 0; i < feedIds.length; i += 200) {
    const { data, error } = await database.from('feed_seen').select('feed_id,item_id').in('feed_id', feedIds.slice(i, i + 200)).in('item_id', itemIds);
    if (error) throw error;
    for (const row of data ?? []) seen.add(`${row.feed_id}:${row.item_id}`);
  }
  return seen;
}

async function markSeen(pairs) {
  if (!pairs.length) return;
  for (let i = 0; i < pairs.length; i += 500) {
    const { error } = await database.from('feed_seen').upsert(pairs.slice(i, i + 500).map(([feedId, itemId]) => ({ feed_id: feedId, item_id: itemId })), { onConflict: 'feed_id,item_id', ignoreDuplicates: true });
    if (error) throw error;
  }
}

async function liveRowsFor(feedIds) {
  const rows = [];
  for (let i = 0; i < feedIds.length; i += 200) {
    const { data, error } = await database.from('feed_live').select('feed_id,item_id,channel_id,message_id,item,started_at').in('feed_id', feedIds.slice(i, i + 200));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

/** Every open stream message of every feed (a row only exists while a stream is on, so there are few): the job reads them in one go. */
async function liveRowsAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await database.from('feed_live').select('feed_id,item_id,channel_id,message_id,item,started_at').order('feed_id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

async function saveLive(row) {
  const { error } = await database.from('feed_live').upsert(row, { onConflict: 'feed_id,item_id' });
  if (error) throw error;
}

async function deleteLive(feedId, itemId) {
  const { error } = await database.from('feed_live').delete().eq('feed_id', feedId).eq('item_id', itemId);
  if (error) throw error;
}

/** What is not shown in any list any more: what was posted long ago and the streams that were never closed. */
async function pruneOld(now = Date.now()) {
  const day = 86_400_000;
  const a = await database.from('feed_seen').delete().lt('seen_at', new Date(now - SEEN_KEEP_DAYS * day).toISOString());
  if (a.error) throw a.error;
  const b = await database.from('feed_live').delete().lt('started_at', new Date(now - 3 * day).toISOString());
  if (b.error) throw b.error;
}

module.exports = { SEEN_KEEP_DAYS, listForGuild, countForGuild, get, getByNumber, listEnabled, forgetList, create, update, remove, seenAmong, markSeen, liveRowsFor, liveRowsAll, saveLive, deleteLive, pruneOld };
