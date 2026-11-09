// i18n-ignore-file: helpers of /premium (the texts are in the catalogs of info.premium.*).
// Which servers a person can give a Premium slot to: the ones where Petto is and they own the server or have Administrator or Manage Server. The same people the
// dashboard lets pick a server. Pure helpers plus two reads of Discord, so they can be checked with fake servers.
const { PermissionFlagsBits } = require('discord.js');

const MANAGE = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild;
/** The most servers asked about at once when a member is not in the cache. */
const FETCH_LIMIT = 25;
const AUTOCOMPLETE_MAX = 25;

/** Whether a member can give a slot to their server: the owner, an Administrator or someone who can manage the server. */
function canManageMember(guild, member) {
  if (!guild || !member) return false;
  if (String(guild.ownerId) === String(member.id)) return true;
  return Boolean(member.permissions?.has?.(MANAGE));
}

/** The member of a server, from the cache or from Discord; null when they are not in it or Discord does not answer. */
async function memberOf(guild, userId) {
  return guild.members?.cache?.get(userId) ?? await guild.members?.fetch?.(userId).catch(() => null) ?? null;
}

async function canManage(guild, userId) {
  return canManageMember(guild, await memberOf(guild, userId));
}

/**
 * The servers a person can manage, those whose name has what was typed first. The members already in the cache are read for free; for the others Discord is asked
 * (at most FETCH_LIMIT servers, the ones that match the typed words), so a bot in thousands of servers does not ask thousands of times.
 */
async function manageableGuilds(client, userId, typed = '', { limit = AUTOCOMPLETE_MAX } = {}) {
  const words = String(typed ?? '').toLowerCase().trim();
  const guilds = [...client.guilds.cache.values()].filter((guild) => !words || guild.name.toLowerCase().includes(words) || guild.id.startsWith(words));
  const found = [];
  const unknown = [];
  for (const guild of guilds) {
    const cached = guild.members?.cache?.get(userId);
    if (cached) { if (canManageMember(guild, cached)) found.push(guild); } else if (String(guild.ownerId) === String(userId)) found.push(guild); else unknown.push(guild);
  }
  const asked = await Promise.all(unknown.slice(0, FETCH_LIMIT).map(async (guild) => (await canManage(guild, userId) ? guild : null)));
  found.push(...asked.filter(Boolean));
  return found.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}

/** A server the person typed (an ID or a name) among the ones Petto is in. Null when there is none, or more than one with that name. */
function findGuild(client, text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const byId = client.guilds.cache.get(value);
  if (byId) return byId;
  const named = [...client.guilds.cache.values()].filter((guild) => guild.name.toLowerCase() === value.toLowerCase());
  return named.length === 1 ? named[0] : null;
}

module.exports = { canManageMember, canManage, manageableGuilds, findGuild, memberOf, AUTOCOMPLETE_MAX };
