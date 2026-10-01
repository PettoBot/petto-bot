const { ChannelType, PermissionFlagsBits } = require('discord.js');
const jailDb = require('../db/jail');
const { createCase, deactivateCase } = require('../db/modActions');
const { forEachWithConcurrency } = require('./concurrency');
const { invalidateJailCache, beginRelease, endRelease } = require('./jailGuard');
const logger = require('./logger');

// What the jail role may not do in any channel. Hiding the channel is what matters; the rest closes the gaps for
// channels a member could still reach some other way.
const JAIL_DENY = {
  ViewChannel: false,
  SendMessages: false,
  SendMessagesInThreads: false,
  AddReactions: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  UseApplicationCommands: false,
  Connect: false,
  Speak: false,
  Stream: false,
  RequestToSpeak: false,
};

const OVERWRITE_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildStageVoice,
  ChannelType.GuildCategory,
]);

const STAFF_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageMessages,
];

const MAX_STAFF_OVERWRITES = 40;
const OVERWRITE_CONCURRENCY = 5;

/** An error whose message is safe to show to the moderator who ran the command. */
class JailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JailError';
    this.userFacing = true;
  }
}

/** The jail role of a server, or null when jail was never set up (or the role was deleted). */
async function getJailRole(guild) {
  const config = await jailDb.getConfig(guild.id);
  return { config, role: config?.jail_role_id ? guild.roles.cache.get(config.jail_role_id) ?? null : null };
}

/** Roles Petto may take away: everything except @everyone, integration-managed roles and roles above its own. */
function removableRoles(member, jailRole) {
  return member.roles.cache.filter((role) => role.id !== member.guild.id && role.id !== jailRole.id && !role.managed && role.editable);
}

/** The role list a jailed member ends up with: the jail role plus whatever cannot be removed from them. */
function jailedRoleIds(member, jailRole) {
  const kept = member.roles.cache.filter((role) => role.id !== member.guild.id && role.id !== jailRole.id && (role.managed || !role.editable));
  return [...kept.keys(), jailRole.id];
}

/** The role list after release: what they hold now, minus the jail role, plus the roles saved when they were jailed. */
function releasedRoleIds(member, jailRole, savedRoleIds) {
  const guild = member.guild;
  const restorable = savedRoleIds.filter((id) => {
    const role = guild.roles.cache.get(id);
    return role && id !== guild.id && !role.managed && role.editable;
  });
  const current = member.roles.cache.filter((role) => role.id !== guild.id && role.id !== jailRole?.id).map((role) => role.id);
  return [...new Set([...current, ...restorable])];
}

/**
 * Jails a member: the roles are saved first, then replaced by the jail role.
 * @returns {Promise<{modCase: object, savedCount: number, expiresAt: string|null}>}
 */
async function jailMember({ guild, member, moderator, reason = null, durationMs = null }) {
  const { role } = await getJailRole(guild);
  if (!role) throw new JailError('Jail is not set up yet. Run `jail setup` first.');
  if (!role.editable) throw new JailError('The jail role is above my highest role. Move my role above it.');
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new JailError('I need the **Manage Roles** permission to jail members.');
  if (await jailDb.getJailed(guild.id, member.id)) throw new JailError('That member is already in jail.');

  const saved = [...removableRoles(member, role).keys()];
  const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;

  // Recorded before any role changes: if Petto stops half way, the roles are still on file.
  await jailDb.addJailed({ guildId: guild.id, userId: member.id, savedRoleIds: saved, jailedBy: moderator.id, reason, expiresAt });
  invalidateJailCache(guild.id);

  try {
    await member.roles.set(jailedRoleIds(member, role), reason ?? 'Petto jail');
  } catch (err) {
    await jailDb.removeJailed(guild.id, member.id).catch(() => {});
    invalidateJailCache(guild.id);
    logger.warn(`Could not jail ${member.id} in guild ${guild.id}: ${err.message}`);
    throw new JailError('I was unable to change that member’s roles. My role may be below theirs.');
  }

  // A member in a voice channel keeps talking until they are moved out.
  if (member.voice?.channelId) await member.voice.disconnect('Petto jail').catch(() => {});

  const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: moderator.id, type: 'jail', reason, expiresAt });
  await jailDb.setJailCase(guild.id, member.id, modCase.case_number).catch((err) => logger.warn(`Could not link jail case #${modCase.case_number}: ${err.message}`));
  return { modCase, savedCount: saved.length, expiresAt };
}

/**
 * Releases a member and restores the roles saved when they were jailed. A member who left the server is simply
 * released: there is nobody to give the roles back to.
 * @returns {Promise<{ok: false} | {ok: true, member: object|null, restoredCount: number, modCase: object}>}
 */
async function unjailMember({ guild, userId, moderator, reason = null }) {
  const row = await jailDb.getJailed(guild.id, userId);
  if (!row) return { ok: false };

  const { role } = await getJailRole(guild);
  const member = await guild.members.fetch(userId).catch(() => null);
  let restoredCount = 0;

  // The roles handed back must not be taken off again by the guard that watches jailed members.
  beginRelease(guild.id, userId);
  try {
    if (member) {
      const next = releasedRoleIds(member, role, row.saved_role_ids ?? []);
      restoredCount = next.filter((id) => !member.roles.cache.has(id)).length;
      try {
        await member.roles.set(next, reason ?? 'Petto jail release');
      } catch (err) {
        logger.warn(`Could not release ${userId} in guild ${guild.id}: ${err.message}`);
        throw new JailError('I was unable to restore that member’s roles. Check that my role is above theirs.');
      }
    }

    await jailDb.removeJailed(guild.id, userId);
    invalidateJailCache(guild.id);
  } finally {
    endRelease(guild.id, userId);
  }

  if (row.case_number) await deactivateCase(guild.id, row.case_number).catch(() => {});
  const modCase = await createCase({ guildId: guild.id, userId, moderatorId: moderator.id, type: 'unjail', reason });
  return { ok: true, member, restoredCount, modCase };
}

/** Puts the jail role back on a jailed member who left and came back. */
async function reapplyJail(member) {
  const row = await jailDb.getJailed(member.guild.id, member.id);
  if (!row) return false;
  const { role } = await getJailRole(member.guild);
  if (!role || !role.editable) return false;

  await member.roles.set(jailedRoleIds(member, role), 'Petto jail: member rejoined').catch((err) => {
    logger.warn(`Could not re-jail ${member.id} in guild ${member.guild.id}: ${err.message}`);
  });
  return true;
}

/** Hides one channel from the jail role. */
async function applyJailOverwrite(channel, role) {
  if (!OVERWRITE_CHANNEL_TYPES.has(channel.type)) return;
  await channel.permissionOverwrites.edit(role, JAIL_DENY, { reason: 'Petto jail setup' });
}

function jailChannelOverwrites(guild, role) {
  const me = guild.members.me;
  const staff = guild.roles.cache
    .filter((r) => r.id !== guild.id && !r.managed && r.permissions.any(STAFF_PERMISSIONS))
    .first(MAX_STAFF_OVERWRITES);
  const talk = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];

  return [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: role.id, allow: [...talk, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    ...(me ? [{ id: me.id, allow: [...talk, PermissionFlagsBits.EmbedLinks] }] : []),
    ...staff.map((staffRole) => ({ id: staffRole.id, allow: talk })),
  ];
}

/**
 * Creates the jail role and channel when they are missing and hides every other channel from the role.
 * Safe to run again: it repairs what is missing and leaves the rest alone.
 */
async function ensureJailSetup(guild) {
  const config = await jailDb.getConfig(guild.id);

  let role = config?.jail_role_id ? guild.roles.cache.get(config.jail_role_id) ?? null : null;
  const createdRole = !role;
  if (!role) {
    role = await guild.roles.create({ name: 'Jailed', color: 0x6b6f7a, permissions: [], mentionable: false, reason: 'Petto jail setup' });
  }

  let channel = config?.jail_channel_id ? guild.channels.cache.get(config.jail_channel_id) ?? null : null;
  const createdChannel = !channel;
  if (!channel) {
    channel = await guild.channels.create({
      name: 'jail',
      type: ChannelType.GuildText,
      topic: 'Jailed members can only see this channel. Staff will talk to you here.',
      permissionOverwrites: jailChannelOverwrites(guild, role),
      reason: 'Petto jail setup',
    });
  } else {
    await channel.permissionOverwrites.edit(role, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }, { reason: 'Petto jail setup' }).catch(() => {});
  }

  await jailDb.upsertConfig(guild.id, { jail_role_id: role.id, jail_channel_id: channel.id });

  let applied = 0;
  let failed = 0;
  const targets = [...guild.channels.cache.values()].filter((other) => other.id !== channel.id && OVERWRITE_CHANNEL_TYPES.has(other.type));
  await forEachWithConcurrency(targets, async (other) => {
    try {
      await applyJailOverwrite(other, role);
      applied += 1;
    } catch (err) {
      failed += 1;
      logger.warn(`Could not hide #${other.name} (${other.id}) from the jail role: ${err.message}`);
    }
  }, OVERWRITE_CONCURRENCY);

  return { role, channel, createdRole, createdChannel, applied, failed };
}

module.exports = {
  JAIL_DENY,
  JailError,
  getJailRole,
  removableRoles,
  jailedRoleIds,
  releasedRoleIds,
  jailMember,
  unjailMember,
  reapplyJail,
  applyJailOverwrite,
  jailChannelOverwrites,
  ensureJailSetup,
};
