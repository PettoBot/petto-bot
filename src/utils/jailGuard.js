const jailDb = require('../db/jail');
const logger = require('./logger');

const CACHE_TTL_MS = 60_000;

// guildId -> { loadedAt, roleId, rows: Map(userId -> row) }. Member updates are frequent, so who is jailed is kept in
// memory for a minute instead of being read for every one of them.
const cache = new Map();
// Members being released right now. Their restored roles must not be mistaken for roles added behind jail's back.
const releasing = new Set();

async function loadGuild(guildId) {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;

  const [config, rows] = await Promise.all([jailDb.getConfig(guildId), jailDb.listJailed(guildId)]);
  const entry = { loadedAt: Date.now(), roleId: config?.jail_role_id ?? null, rows: new Map(rows.map((row) => [row.user_id, row])) };
  cache.set(guildId, entry);
  return entry;
}

/** Forget what is cached for a server; called whenever somebody is jailed or released. */
function invalidateJailCache(guildId) {
  cache.delete(guildId);
}

function beginRelease(guildId, userId) {
  releasing.add(`${guildId}:${userId}`);
}

function endRelease(guildId, userId) {
  releasing.delete(`${guildId}:${userId}`);
}

/**
 * Called when a member gains roles. If the member is jailed, every role that is not the jail role is taken off again
 * and added to the list of roles they get back on release, so a role handed out by another bot (verification, join
 * roles, reaction roles) can neither lift the jail nor be lost.
 * @returns {Promise<number>} how many roles were taken off
 */
async function enforceJail(oldMember, newMember) {
  if (newMember.user.bot || releasing.has(`${newMember.guild.id}:${newMember.id}`)) return 0;

  const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
  if (!added.size) return 0;

  const entry = await loadGuild(newMember.guild.id);
  const row = entry.rows.get(newMember.id);
  if (!row) return 0;

  const unexpected = added.filter((role) => role.id !== entry.roleId && !role.managed && role.editable);
  if (!unexpected.size) return 0;

  try {
    await newMember.roles.remove([...unexpected.keys()], 'Petto jail: member is in jail');
    const saved = [...new Set([...(row.saved_role_ids ?? []), ...unexpected.keys()])];
    await jailDb.setSavedRoles(newMember.guild.id, newMember.id, saved);
    row.saved_role_ids = saved;
    return unexpected.size;
  } catch (err) {
    logger.warn(`Could not enforce jail on ${newMember.id} in guild ${newMember.guild.id}: ${err.message}`);
    return 0;
  }
}

module.exports = { invalidateJailCache, beginRelease, endRelease, enforceJail };
