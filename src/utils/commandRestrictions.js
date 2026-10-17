// !restrictcommand: a command with roles set can only be used by members who have one of them. The server owner and the
// administrators always can, so a server never locks itself out of a command.
const { PermissionFlagsBits } = require('discord.js');

const db = () => require('../db/commandRestrictions');

/** The role ids the member is missing for the command, or null when they may use it. */
async function restrictedFor(guildId, commandName, member, store = db()) {
  if (!member || member.guild?.ownerId === member.id) return null;
  const perms = member.permissions;
  const admin = typeof perms?.has === 'function' ? perms.has(PermissionFlagsBits.Administrator) : typeof perms === 'string' && (BigInt(perms) & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator;
  if (admin) return null;
  const map = await store.restrictionMap(guildId);
  const roles = map?.[commandName];
  if (!roles?.length) return null;
  // A cached member has a role manager; the raw member of an interaction has a list of ids.
  const has = member.roles?.cache ? roles.some((id) => member.roles.cache.has(id)) : Array.isArray(member.roles) && roles.some((id) => member.roles.includes(id));
  return has ? null : roles;
}

/** The first word of a prefix command after the prefix routes: `{ commandName, argText }`, with a word route applied. */
function applyWordRoute(words, commandName, argText) {
  const first = /^\s*(\S+)/.exec(argText)?.[1]?.toLowerCase();
  const route = first ? words?.[first] : null;
  if (!route) return null;
  const rest = argText.replace(/^\s*\S+\s*/, '');
  return { commandName: route.command ?? commandName, argText: [...(route.args ?? []), rest].filter(Boolean).join(' ') };
}

module.exports = { restrictedFor, applyWordRoute };
