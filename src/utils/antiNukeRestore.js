const { PermissionFlagsBits } = require('discord.js');
const logger = require('./logger');
const { t, tn, currentLanguage } = require('../i18n');

/**
 * What the anti-nuke keeps of an action so it can be put back. Only what Discord lets a bot rebuild: a channel or a role
 * comes back with its settings (not its messages or members), a ban is lifted, a role a human lost is given again.
 */
const MAX_ITEMS = 25;

function snapshotChannel(channel) {
  return {
    kind: 'channel',
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId ?? null,
    topic: channel.topic ?? null,
    nsfw: Boolean(channel.nsfw),
    rateLimitPerUser: channel.rateLimitPerUser ?? 0,
    bitrate: channel.bitrate ?? undefined,
    userLimit: channel.userLimit ?? undefined,
    overwrites: [...(channel.permissionOverwrites?.cache?.values() ?? [])].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
  };
}

function snapshotRole(role) {
  return {
    kind: 'role',
    name: role.name,
    color: role.color,
    hoist: Boolean(role.hoist),
    mentionable: Boolean(role.mentionable),
    permissions: role.permissions.bitfield.toString(),
  };
}

function describeItem(item, lang = currentLanguage()) {
  switch (item.kind) {
    case 'channel': return t(lang, 'security.antinuke.item.channel', { name: item.name });
    case 'role': return t(lang, 'security.antinuke.item.role', { name: item.name });
    case 'unban': return t(lang, 'security.antinuke.item.unban', { user: `<@${item.userId}>` });
    case 'reban': return t(lang, 'security.antinuke.item.reban', { user: `<@${item.userId}>` });
    case 'delete_channel': return t(lang, 'security.antinuke.item.deleteChannel', { id: item.id });
    case 'delete_role': return t(lang, 'security.antinuke.item.deleteRole', { id: item.id });
    default: return item.kind;
  }
}

/** Puts one thing back. Answers a short line for the report. */
async function restoreItem(guild, item, lang) {
  switch (item.kind) {
    case 'channel': {
      const parent = item.parentId && guild.channels.cache.has(item.parentId) ? item.parentId : null;
      const overwrites = (item.overwrites ?? [])
        .filter((o) => (o.type === 0 ? guild.roles.cache.has(o.id) : guild.members.cache.has(o.id)))
        .map((o) => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }));
      await guild.channels.create({
        name: item.name,
        type: item.type,
        parent,
        topic: item.topic ?? undefined,
        nsfw: item.nsfw,
        rateLimitPerUser: item.rateLimitPerUser || undefined,
        bitrate: item.bitrate,
        userLimit: item.userLimit,
        permissionOverwrites: overwrites,
        reason: t(lang, 'security.antinuke.audit.restoreChannel'),
      });
      return t(lang, 'security.antinuke.restored.channel', { name: item.name });
    }
    case 'role':
      await guild.roles.create({ name: item.name, color: item.color, hoist: item.hoist, mentionable: item.mentionable, permissions: BigInt(item.permissions), reason: t(lang, 'security.antinuke.audit.restoreRole') });
      return t(lang, 'security.antinuke.restored.role', { name: item.name });
    case 'unban':
      await guild.members.unban(item.userId, t(lang, 'security.antinuke.audit.undoBan'));
      return t(lang, 'security.antinuke.restored.unban', { user: `<@${item.userId}>` });
    case 'reban':
      await guild.members.ban(item.userId, { reason: t(lang, 'security.antinuke.audit.undoUnban') });
      return t(lang, 'security.antinuke.restored.reban', { user: `<@${item.userId}>` });
    case 'delete_channel': {
      const channel = guild.channels.cache.get(item.id);
      if (!channel) return null;
      await channel.delete(t(lang, 'security.antinuke.audit.undoChannelCreate'));
      return t(lang, 'security.antinuke.restored.deleteChannel', { name: channel.name });
    }
    case 'delete_role': {
      const role = guild.roles.cache.get(item.id);
      if (!role) return null;
      await role.delete(t(lang, 'security.antinuke.audit.undoRoleCreate'));
      return t(lang, 'security.antinuke.restored.deleteRole', { name: role.name });
    }
    default:
      return null;
  }
}

/**
 * Puts back what an event kept, plus the roles taken from the account that was quarantined. Answers the lines of what
 * worked and what did not, so the staff knows exactly what is still missing.
 */
async function restoreEvent(guild, event, lang = currentLanguage()) {
  const done = [];
  const failed = [];
  for (const item of event.restorable ?? []) {
    try {
      const line = await restoreItem(guild, item, lang);
      if (line) done.push(line);
    } catch (err) {
      logger.warn(`Anti-nuke restore (${item.kind}) failed in ${guild.id}: ${err.message}`);
      failed.push(t(lang, 'security.antinuke.restored.failed', { item: describeItem(item, lang) }));
    }
  }
  if (event.previous_roles?.length) {
    const member = await guild.members.fetch(event.executor_id).catch(() => null);
    if (member) {
      const roles = event.previous_roles.filter((id) => guild.roles.cache.has(id) && guild.roles.cache.get(id).position < (guild.members.me?.roles.highest.position ?? 0));
      if (roles.length) {
        await member.roles.add(roles, t(lang, 'security.antinuke.audit.rolesBack'))
          .then(() => done.push(tn(lang, 'security.antinuke.restored.rolesBack', roles.length, { count: roles.length, user: `<@${event.executor_id}>` })))
          .catch(() => failed.push(t(lang, 'security.antinuke.restored.rolesBackFailed')));
      }
    }
  }
  return { done, failed };
}

/** Who may press restore: the owner and the administrators. */
function canRestore(member) {
  return member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = { MAX_ITEMS, snapshotChannel, snapshotRole, restoreEvent, canRestore, describeItem };
