// Runs the Vanity and Server Tag rules for members: builds what is known about a member from Discord, loads the rules of the
// server and hands both to the engine. Every change to one member goes through a lock of its own, so events that arrive
// together (an update and a presence change) are handled one after the other.
const { evaluate } = require('./engine');
const db = require('../../db/identity');
const { emitAction, emitNotification } = require('./emit');
const logger = require('../logger');

const LOCKS = 64;
const queues = Array.from({ length: LOCKS }, () => Promise.resolve());

function lockIndex(guildId, userId) {
  let hash = 0;
  for (const char of `${guildId}:${userId}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % LOCKS;
}

/** Runs `task` after the earlier ones of the same member, whatever they did. */
function withMemberLock(guildId, userId, task) {
  const index = lockIndex(guildId, userId);
  const run = queues[index].then(task, task);
  queues[index] = run.catch(() => {});
  return run;
}

/** The custom status text of a member, from their presence ('' when they have none). */
function customStatusOf(presence) {
  const activity = presence?.activities?.find((entry) => entry.type === 4);
  return activity?.state?.trim() ?? '';
}

/**
 * What the rules need to know about a guild member. `customStatus` is only known when Discord gave the bot a presence for
 * them: without one it is marked unknown (and the rules that read it leave their grants as they were) rather than empty.
 */
function memberIdentity(member, { primary } = {}) {
  const user = member.user;
  const identity = {
    guildId: member.guild.id,
    userId: user.id,
    isBot: Boolean(user.bot),
    username: user.username ?? '',
    globalName: user.globalName ?? '',
    guildNickname: member.nickname ?? '',
    displayName: member.displayName ?? '',
    avatarUrl: member.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? '',
    customStatus: '',
    unknownSources: new Set(['custom_status']),
    primaryGuild: primary !== undefined ? primary : primaryGuildOf(user),
    roleIds: new Set(member.roles.cache.keys()),
  };
  if (member.presence) {
    identity.customStatus = customStatusOf(member.presence);
    identity.unknownSources.delete('custom_status');
  }
  return identity;
}

/** The Server Tag of a user: `null` when Discord says there is none, `undefined`-like unknown data is also given as null (no rule can match it). */
function primaryGuildOf(user) {
  const primary = user.primaryGuild;
  if (!primary) return null;
  return { identityGuildId: primary.identityGuildId ?? '', identityEnabled: primary.identityEnabled ?? null, tag: primary.tag ?? '', badge: primary.badge ?? '' };
}

function roleClient(guild) {
  return {
    add: (guildId, userId, roleId) => guild.members.addRole({ user: userId, role: roleId, reason: 'Vanity / Server Tag rule' }),
    remove: (guildId, userId, roleId) => guild.members.removeRole({ user: userId, role: roleId, reason: 'Vanity / Server Tag rule' }),
  };
}

/** Which sources to evaluate: `vanity`, `guildtag`, or both. Rules are read once per call. */
async function loadRules(guildId, source) {
  const [vanity, guildtag] = await Promise.all([
    source === 'guildtag' ? null : db.listVanityRules(guildId),
    source === 'vanity' ? null : db.listGuildTagRules(guildId),
  ]);
  return { vanity, guildtag };
}

/** Evaluates one member for the chosen source (both by default). Errors are logged, never thrown, so an event handler cannot break on it. */
async function evaluateMember(member, { source = null, rules = null, primary } = {}) {
  if (!member || member.user?.bot) return [];
  const guildId = member.guild.id;
  try {
    return await withMemberLock(guildId, member.id, async () => {
      const loaded = rules ?? await loadRules(guildId, source);
      const active = (loaded.vanity?.length ?? 0) + (loaded.guildtag?.length ?? 0);
      if (!active && !(await db.hasActiveRules(guildId))) return [];
      return evaluate(memberIdentity(member, { primary }), loaded, {
        roles: roleClient(member.guild),
        onAction: (action) => emitAction(member.guild, action).catch((error) => logger.warn({ guildId }, `Identity log failed: ${error.message}`)),
        onNotify: (action) => emitNotification(member.guild, member, action).catch((error) => logger.warn({ guildId }, `Identity notification failed: ${error.message}`)),
      });
    });
  } catch (error) {
    logger.error({ guildId, userId: member.id, action: 'identity-evaluate' }, `Vanity evaluation failed: ${error.message}`);
    return [];
  }
}

module.exports = { evaluateMember, memberIdentity, primaryGuildOf, customStatusOf, loadRules, withMemberLock, roleClient };
