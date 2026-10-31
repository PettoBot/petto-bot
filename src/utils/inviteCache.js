// In-memory snapshot of each guild's invites (code -> {uses, inviterId, maxUses}), used to diff against a fresh fetch on member join and
// figure out which invite was used: Discord does not tell you directly, so this is the standard "diff the uses count" approach.
//
// What it costs Discord (the rules this file keeps):
//   - the list of invites is fetched when the bot starts (once per server where it can read them), when it joins a server, and once per
//     member join; invite create and delete events only change the snapshot, they never fetch;
//   - a server where Petto lacks Manage Server is never asked (the permission is read from memory, no request is made to find out);
//   - after an error (403, 429, 5xx, network) that server is left alone for a while and the snapshot is dropped (it could be stale), with one
//     short log line, instead of asking again on every join;
//   - nothing is kept for a server that has no snapshot, and the number of snapshots is capped.
const logger = require('./logger');

const MAX_GUILDS = 5000;
const BACKOFF_MS = { forbidden: 10 * 60_000, rateLimited: 2 * 60_000, server: 60_000, other: 60_000 };

const cache = new Map(); // guildId -> Map<code, { uses, inviterId, maxUses }>; the oldest guild goes first when the cap is reached
const backoff = new Map(); // guildId -> instant (ms) before which the guild is not asked again

function snapshotFromCollection(invites) {
  const map = new Map();
  for (const invite of invites.values()) {
    map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null, maxUses: invite.maxUses ?? 0 });
  }
  return map;
}

/** Puts a guild last in a capped map (and drops the first ones past the cap), so what is not used goes away first. */
function remember(map, key, value, max = MAX_GUILDS) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

function reasonOf(error) {
  const status = Number(error?.status ?? error?.httpStatus ?? 0);
  if (status === 429 || error?.name === 'RateLimitError') return 'rateLimited';
  if (status === 403 || error?.code === 50013 || error?.code === 50001) return 'forbidden';
  if (status >= 500) return 'server';
  return 'other';
}

/** True while a guild is left alone after an error. */
function isBackedOff(guildId, now = Date.now()) {
  const until = backoff.get(guildId);
  if (until === undefined) return false;
  if (now >= until) { backoff.delete(guildId); return false; }
  return true;
}

/** Leaves a guild alone after an error (longer when it was a permission, as long as Discord said when it was a rate limit) and forgets its snapshot. */
function noteFetchError(guildId, error, now = Date.now()) {
  const reason = reasonOf(error);
  const told = Number(error?.retryAfter ?? error?.timeToReset ?? 0);
  const wait = reason === 'rateLimited' && told > 0 ? Math.min(Math.max(told, 1000), 10 * 60_000) : BACKOFF_MS[reason];
  const already = isBackedOff(guildId, now);
  remember(backoff, guildId, now + wait);
  cache.delete(guildId);
  if (!already) logger.warn(`Invites of guild ${guildId} could not be read (${reason}${error?.status ? ` ${error.status}` : ''}); not asking again for ${Math.round(wait / 1000)}s.`);
}

/**
 * The invites of a guild from Discord, or null when they cannot or should not be asked: Petto lacks Manage Server (no request is made),
 * the guild is backing off after an error, or Discord answered with one (which starts the back-off).
 */
async function fetchInvites(guild) {
  if (!guild.members?.me?.permissions?.has('ManageGuild')) { cache.delete(guild.id); return null; }
  if (isBackedOff(guild.id)) { cache.delete(guild.id); return null; }
  try {
    return await guild.invites.fetch();
  } catch (error) {
    noteFetchError(guild.id, error);
    return null;
  }
}

async function warmGuild(guild) {
  const invites = await fetchInvites(guild);
  if (invites) remember(cache, guild.id, snapshotFromCollection(invites));
}

function getGuildCache(guildId) {
  return cache.get(guildId);
}

/** An invite was created: added to the snapshot of a guild that has one (a guild with no snapshot would get a partial one that points at the wrong invite). */
function setInvite(guildId, code, data) {
  cache.get(guildId)?.set(code, { maxUses: 0, ...data });
}

function deleteInvite(guildId, code) {
  cache.get(guildId)?.delete(code);
}

function replaceGuildCache(guildId, invites) {
  remember(cache, guildId, snapshotFromCollection(invites));
}

function dropGuild(guildId) {
  cache.delete(guildId);
}

/** For the checks: forgets everything. */
function reset() {
  cache.clear();
  backoff.clear();
}

module.exports = { warmGuild, fetchInvites, getGuildCache, setInvite, deleteInvite, replaceGuildCache, dropGuild, isBackedOff, noteFetchError, remember, snapshotFromCollection, reset, MAX_GUILDS };
