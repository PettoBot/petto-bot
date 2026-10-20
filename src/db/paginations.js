// Paginated messages (`!pagination`): one row per message of Petto that has pages and the buttons to turn them.
// See the `pagination_messages` table in schema.sql for the shape of `pages`.
const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');

// The message ids of the paginated messages of each server, so a deleted message only costs a database read when it was one
// of them (the delete events of a busy server are many). Kept for a minute and cleared by every change made here.
const messageIdCache = createExpiringCache(60_000);

const MAX_PAGES = 25;

function clean(row) {
  if (!row) return null;
  return { ...row, id: String(row.id), pages: Array.isArray(row.pages) ? row.pages : [], private: row.private === true };
}

async function getPagination(id) {
  if (!/^\d{1,19}$/.test(String(id ?? ''))) return null;
  const { data, error } = await database.from('pagination_messages').select('*').eq('id', String(id)).maybeSingle();
  if (error) throw error;
  return clean(data);
}

async function getByMessage(guildId, messageId) {
  const { data, error } = await database.from('pagination_messages').select('*').eq('guild_id', guildId).eq('message_id', String(messageId)).maybeSingle();
  if (error) throw error;
  return clean(data);
}

async function listPaginations(guildId) {
  const { data, error } = await database.from('pagination_messages').select('*').eq('guild_id', guildId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(clean);
}

async function countPaginations(guildId) {
  return (await listPaginations(guildId)).length;
}

/** The ids of the paginated messages of a server (cached for a minute). */
async function messageIdsOf(guildId) {
  return messageIdCache.get(String(guildId), async () => new Set((await listPaginations(guildId)).map((row) => String(row.message_id))));
}

function forget(guildId) {
  messageIdCache.delete(String(guildId));
}

async function createPagination({ guildId, channelId, messageId, kind, pages, isPrivate = false, postedByPetto = false, createdBy = null }) {
  const { data, error } = await database.from('pagination_messages').insert({
    guild_id: guildId, channel_id: channelId, message_id: String(messageId), kind, pages: pages.slice(0, MAX_PAGES), private: Boolean(isPrivate),
    posted_by_petto: Boolean(postedByPetto), created_by: createdBy,
  }).select('*').single();
  if (error) throw error;
  forget(guildId);
  return clean(data);
}

async function updatePagination(row, changes) {
  const values = { updated_at: new Date().toISOString() };
  if (changes.pages) values.pages = changes.pages.slice(0, MAX_PAGES);
  if (typeof changes.isPrivate === 'boolean') values.private = changes.isPrivate;
  if (changes.kind) values.kind = changes.kind;
  const { data, error } = await database.from('pagination_messages').update(values).eq('id', String(row.id)).select('*').single();
  if (error) throw error;
  forget(row.guild_id);
  return clean(data);
}

async function deletePagination(row) {
  const { data, error } = await database.from('pagination_messages').delete().eq('id', String(row.id)).select('id');
  if (error) throw error;
  forget(row.guild_id);
  return (data ?? []).length > 0;
}

/** Removes the rows of deleted messages (any number of ids of one server); returns how many went away. */
async function deleteByMessages(guildId, messageIds) {
  const ids = [...new Set((messageIds ?? []).map(String))];
  if (!ids.length) return 0;
  const { data, error } = await database.from('pagination_messages').delete().eq('guild_id', guildId).in('message_id', ids).select('id');
  if (error) throw error;
  forget(guildId);
  return (data ?? []).length;
}

async function deleteByChannel(guildId, channelId) {
  const { data, error } = await database.from('pagination_messages').delete().eq('guild_id', guildId).eq('channel_id', String(channelId)).select('id');
  if (error) throw error;
  forget(guildId);
  return (data ?? []).length;
}

/** `!pagination reset`: every paginated message of the server; returns the rows removed. */
async function deleteAll(guildId) {
  const { data, error } = await database.from('pagination_messages').delete().eq('guild_id', guildId).select('*');
  if (error) throw error;
  forget(guildId);
  return (data ?? []).map(clean);
}

module.exports = {
  MAX_PAGES, getPagination, getByMessage, listPaginations, countPaginations, messageIdsOf, createPagination, updatePagination,
  deletePagination, deleteByMessages, deleteByChannel, deleteAll,
};
