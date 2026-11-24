// Where and for whom a custom command works: the channels and roles it is allowed in or blocked from, the NSFW switch, and the "restricted" switch (what a member who
// is not a moderator asks for is answered in another channel). It is kept in the `options` of the command (custom_commands.options), next to what the commands written
// in code already had there (`roles` and `channels` with a mode). Both ways are read: the old ones count as the same lists. Nothing here talks to Discord or the database.
const { PermissionFlagsBits } = require('discord.js');

const MAX_IDS = 25;
const ID = /^\d{15,25}$/;

const idsOf = (value) => (Array.isArray(value) ? [...new Set(value.map(String).filter((id) => ID.test(id)))].slice(0, MAX_IDS) : []);

/** The scope of a command from its saved options (nothing saved: it works everywhere for everybody). The lists of the old way (`roles`, `channels` with a mode) are joined in. */
function scopeOf(raw) {
  const options = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const legacyRoles = idsOf(options.roles?.ids);
  const legacyChannels = idsOf(options.channels?.ids);
  const join = (a, b) => [...new Set([...a, ...b])].slice(0, MAX_IDS);
  return {
    allowChannels: join(idsOf(options.allowChannels), options.channels?.mode === 'ignore' ? [] : legacyChannels),
    blockChannels: join(idsOf(options.blockChannels), options.channels?.mode === 'ignore' ? legacyChannels : []),
    allowRoles: join(idsOf(options.allowRoles), options.roles?.mode === 'ignore' ? [] : legacyRoles),
    blockRoles: join(idsOf(options.blockRoles), options.roles?.mode === 'ignore' ? legacyRoles : []),
    nsfw: options.nsfw === true,
    restricted: options.restricted === true,
    restrictedChannel: ID.test(String(options.restrictedChannel ?? '')) ? String(options.restrictedChannel) : null,
  };
}

/** The part of the options that the commands page of the dashboard writes, as it is saved (only the new fields: the old `roles` and `channels` belong to the editor of code). */
function scopeFields(raw) {
  const options = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    allowChannels: idsOf(options.allowChannels), blockChannels: idsOf(options.blockChannels), allowRoles: idsOf(options.allowRoles), blockRoles: idsOf(options.blockRoles),
    nsfw: options.nsfw === true, restricted: options.restricted === true, restrictedChannel: ID.test(String(options.restrictedChannel ?? '')) ? String(options.restrictedChannel) : null,
  };
}

/** The fields of the scope that are set, to save (a command that was never limited keeps options without them). */
function compactScope(raw) {
  const fields = scopeFields(raw);
  const out = {};
  for (const [key, value] of Object.entries(fields)) if (Array.isArray(value) ? value.length > 0 : Boolean(value)) out[key] = value;
  return out;
}

/** A moderator: somebody who can manage messages or the server. A member whose permissions cannot be read is not one. */
function isModerator(member) {
  const permissions = member?.permissions;
  if (typeof permissions?.has !== 'function') return false;
  return permissions.has(PermissionFlagsBits.Administrator) || permissions.has(PermissionFlagsBits.ManageGuild) || permissions.has(PermissionFlagsBits.ManageMessages);
}

/** Whether a channel is NSFW; a thread counts as the channel it is in. */
function isNsfwChannel(channel) {
  return channel?.nsfw === true || channel?.parent?.nsfw === true;
}

/** Whether this member may use the command in this channel. A thread counts as its channel. Blocked wins over allowed. */
function allows(raw, member, channel) {
  const scope = scopeOf(raw);
  const here = [channel?.id, channel?.parentId].filter(Boolean).map(String);
  if (scope.blockChannels.some((id) => here.includes(id))) return false;
  if (scope.allowChannels.length && !scope.allowChannels.some((id) => here.includes(id))) return false;
  const has = (id) => member?.roles?.cache?.has?.(id) === true;
  if (scope.blockRoles.some(has)) return false;
  if (scope.allowRoles.length && !scope.allowRoles.some(has)) return false;
  if (scope.nsfw && !isNsfwChannel(channel)) return false;
  return true;
}

/** The channel the answer goes to when the command is restricted and the member is not a moderator (a text channel of the server), or null: it is answered where it was used. */
function redirectChannel(raw, member, guild) {
  const scope = scopeOf(raw);
  if (!scope.restricted || !scope.restrictedChannel || isModerator(member)) return null;
  const channel = guild?.channels?.cache?.get(scope.restrictedChannel);
  if (!channel?.isTextBased?.() || channel.isDMBased?.()) return null;
  const me = guild.members?.me;
  const can = channel.permissionsFor?.(me);
  if (!can?.has(PermissionFlagsBits.ViewChannel) || !can.has(PermissionFlagsBits.SendMessages)) return null;
  return channel;
}

module.exports = { MAX_IDS, scopeOf, scopeFields, compactScope, isModerator, isNsfwChannel, allows, redirectChannel };
