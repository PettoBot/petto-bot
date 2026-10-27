// The YouTube push subscriptions (table `youtube_websub` of schema.sql): one row for each channel the bot asked YouTube to tell it about.
const database = require('./database');

const COLUMNS = 'channel_id,secret,status,expires_at,requested_at,verified_at,last_push_at,fails';

/** Every subscription (there is one row for each YouTube channel that is followed, so this is small). */
async function listAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await database.from('youtube_websub').select(COLUMNS).order('channel_id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

async function get(channelId) {
  const { data, error } = await database.from('youtube_websub').select(COLUMNS).eq('channel_id', channelId).maybeSingle();
  if (error) throw error;
  return data;
}

/** A subscription that was asked for and is waiting for YouTube to confirm it (the secret of a channel that already has one is kept). */
async function savePending(channelId, secret, now = Date.now()) {
  const kept = await get(channelId);
  const row = { channel_id: channelId, secret: kept?.secret ?? secret, status: kept?.status === 'active' ? 'active' : 'pending', requested_at: new Date(now).toISOString() };
  const { error } = await database.from('youtube_websub').upsert(row, { onConflict: 'channel_id' });
  if (error) throw error;
  return row.secret;
}

async function markVerified(channelId, expiresAt, now = Date.now()) {
  const { error } = await database.from('youtube_websub').update({ status: 'active', expires_at: new Date(expiresAt).toISOString(), verified_at: new Date(now).toISOString(), fails: 0 }).eq('channel_id', channelId);
  if (error) throw error;
}

async function markPush(channelId, now = Date.now()) {
  const { error } = await database.from('youtube_websub').update({ last_push_at: new Date(now).toISOString() }).eq('channel_id', channelId);
  if (error) throw error;
}

async function markFailed(channelId) {
  const kept = await get(channelId);
  if (!kept) return;
  const { error } = await database.from('youtube_websub').update({ fails: (kept.fails ?? 0) + 1 }).eq('channel_id', channelId);
  if (error) throw error;
}

/** The subscriptions of channels nobody follows any more are forgotten (YouTube lets them run out by themselves). */
async function removeExcept(channelIds) {
  const keep = new Set(channelIds);
  const gone = (await listAll()).filter((row) => !keep.has(row.channel_id) && (!row.expires_at || Date.parse(row.expires_at) < Date.now())).map((row) => row.channel_id);
  for (let i = 0; i < gone.length; i += 200) {
    const { error } = await database.from('youtube_websub').delete().in('channel_id', gone.slice(i, i + 200));
    if (error) throw error;
  }
  return gone.length;
}

module.exports = { listAll, get, savePending, markVerified, markPush, markFailed, removeExcept };
