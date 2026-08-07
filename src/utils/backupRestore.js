const { ChannelType } = require('discord.js');

const RESTORABLE_CHANNEL_TYPES = new Set([
  ChannelType.GuildCategory,
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
].filter((type) => type !== undefined));

function bitfield(value) {
  try {
    return BigInt(String(value ?? '0'));
  } catch {
    return 0n;
  }
}

function isRestorableChannel(channel) {
  return !channel.isThread?.() && RESTORABLE_CHANNEL_TYPES.has(channel.type);
}

function findChannel(guild, data) {
  const byId = guild.channels.cache.get(String(data.id));
  if (byId && isRestorableChannel(byId)) return byId;
  return guild.channels.cache.find((channel) => isRestorableChannel(channel)
    && channel.type === data.type
    && channel.name === data.name) ?? null;
}

function buildOverwrites(guild, data, roleMap) {
  return (data.permissionOverwrites ?? []).flatMap((overwrite) => {
    const type = Number(overwrite.type) === 1 ? 1 : 0;
    const mappedRole = roleMap.get(String(overwrite.id));
    const id = mappedRole ?? (type === 1 ? String(overwrite.id) : null);
    if (!id) return [];
    return [{ id, type, allow: bitfield(overwrite.allow), deny: bitfield(overwrite.deny) }];
  });
}

function channelOptions(data, parentId, permissionOverwrites, reason, includeType = true) {
  const options = {
    name: String(data.name || 'restored-channel').slice(0, 100),
    reason,
  };
  if (includeType) options.type = data.type;
  if (parentId) options.parent = parentId;
  if (data.topic != null && (data.type === ChannelType.GuildText || data.type === ChannelType.GuildAnnouncement || data.type === ChannelType.GuildForum)) options.topic = String(data.topic).slice(0, 4096);
  if (data.nsfw != null && data.type !== ChannelType.GuildCategory) options.nsfw = Boolean(data.nsfw);
  if (data.rateLimitPerUser != null) options.rateLimitPerUser = Number(data.rateLimitPerUser) || 0;
  if (data.bitrate != null && (data.type === ChannelType.GuildVoice || data.type === ChannelType.GuildStageVoice)) options.bitrate = Number(data.bitrate);
  if (data.userLimit != null && (data.type === ChannelType.GuildVoice || data.type === ChannelType.GuildStageVoice)) options.userLimit = Number(data.userLimit);
  if (permissionOverwrites.length) options.permissionOverwrites = permissionOverwrites;
  return options;
}

function normaliseSnapshot(snapshot) {
  if (!snapshot || snapshot.format !== 'petto-server-backup' || !Array.isArray(snapshot.roles) || !Array.isArray(snapshot.channels)) {
    const error = new Error('Invalid or unsupported Petto backup format.');
    error.code = 'invalid_backup';
    throw error;
  }
  return snapshot;
}

/**
 * Restores a Petto snapshot into the same Discord server.
 * Merge creates or updates resources without deleting anything. Replace also
 * removes user-created channels and roles that are not present in the snapshot.
 */
async function restoreBackup(guild, rawSnapshot, { mode = 'merge', reason = 'Petto backup restore' } = {}) {
  const snapshot = normaliseSnapshot(rawSnapshot);
  const replace = mode === 'replace';
  if (!['merge', 'replace'].includes(mode)) {
    const error = new Error('Restore mode must be merge or replace.');
    error.code = 'invalid_mode';
    throw error;
  }

  const result = {
    mode,
    roles: { created: 0, updated: 0, skipped: 0, failed: 0 },
    channels: { created: 0, updated: 0, skipped: 0, failed: 0 },
    emojis: { created: 0, updated: 0, skipped: 0, failed: 0 },
    deleted: { roles: 0, channels: 0 },
    errors: [],
  };
  const roleMap = new Map([[String(guild.id), String(guild.id)]]);
  const targetRoleIds = new Set([String(guild.id)]);

  const roles = [...snapshot.roles].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  for (const data of roles) {
    if (!data?.id || String(data.id) === String(guild.id)) continue;
    const existing = guild.roles.cache.get(String(data.id));
    if (existing?.managed) {
      result.roles.skipped++;
      continue;
    }
    try {
      const role = existing ?? await guild.roles.create({
        name: String(data.name || 'restored-role').slice(0, 100),
        color: Number(data.color) || 0,
        hoist: Boolean(data.hoist),
        mentionable: Boolean(data.mentionable),
        permissions: bitfield(data.permissions),
        reason,
      });
      roleMap.set(String(data.id), String(role.id));
      targetRoleIds.add(String(role.id));
      await role.edit({
        name: String(data.name || role.name).slice(0, 100),
        color: Number(data.color) || 0,
        hoist: Boolean(data.hoist),
        mentionable: Boolean(data.mentionable),
        permissions: bitfield(data.permissions),
        reason,
      });
      result.roles[existing ? 'updated' : 'created']++;
    } catch (error) {
      result.roles.failed++;
      result.errors.push(`role:${data.name || data.id}: ${error.message}`);
    }
  }

  try {
    const positions = roles
      .map((data) => ({ role: roleMap.get(String(data.id)), position: Number(data.position) || 1 }))
      .filter((entry) => entry.role && entry.role !== String(guild.id));
    if (positions.length) await guild.roles.setPositions(positions, { reason });
  } catch (error) {
    result.errors.push(`role_positions: ${error.message}`);
  }

  const channelMap = new Map();
  const targetChannelIds = new Set();
  const channels = [...snapshot.channels]
    .filter((data) => data && RESTORABLE_CHANNEL_TYPES.has(data.type))
    .sort((a, b) => (a.type === ChannelType.GuildCategory ? -1 : 0) - (b.type === ChannelType.GuildCategory ? -1 : 0) || Number(a.position ?? 0) - Number(b.position ?? 0));

  for (const data of channels) {
    const parentId = data.parentId ? channelMap.get(String(data.parentId)) : null;
    const overwrites = buildOverwrites(guild, data, roleMap);
    const existing = findChannel(guild, data);
    try {
      const createData = channelOptions(data, parentId, overwrites, reason, true);
      const target = existing ?? await guild.channels.create(createData);
      if (existing) {
        await target.edit(channelOptions(data, parentId, [], reason, false));
        if (overwrites.length) await target.permissionOverwrites.set(overwrites, reason);
      }
      channelMap.set(String(data.id), String(target.id));
      targetChannelIds.add(String(target.id));
      result.channels[existing ? 'updated' : 'created']++;
      if (Number.isInteger(Number(data.position))) await target.setPosition(Number(data.position), { reason }).catch(() => {});
    } catch (error) {
      result.channels.failed++;
      result.errors.push(`channel:${data.name || data.id}: ${error.message}`);
    }
  }

  const guildData = snapshot.guild ?? {};
  const guildEdit = {};
  if (guildData.name) guildEdit.name = String(guildData.name).slice(0, 100);
  for (const key of ['verificationLevel', 'defaultMessageNotifications', 'explicitContentFilter', 'afkTimeout']) {
    if (guildData[key] !== undefined && guildData[key] !== null) guildEdit[key] = guildData[key];
  }
  if (guildData.afkChannelId !== undefined) guildEdit.afkChannel = guildData.afkChannelId ? channelMap.get(String(guildData.afkChannelId)) ?? null : null;
  if (guildData.systemChannelId !== undefined) guildEdit.systemChannel = guildData.systemChannelId ? channelMap.get(String(guildData.systemChannelId)) ?? null : null;
  if (guildData.rulesChannelId !== undefined) guildEdit.rulesChannel = guildData.rulesChannelId ? channelMap.get(String(guildData.rulesChannelId)) ?? null : null;
  if (guildData.publicUpdatesChannelId !== undefined) guildEdit.publicUpdatesChannel = guildData.publicUpdatesChannelId ? channelMap.get(String(guildData.publicUpdatesChannelId)) ?? null : null;
  if (guildData.iconURL) guildEdit.icon = guildData.iconURL;
  if (guildData.bannerURL) guildEdit.banner = guildData.bannerURL;
  try {
    if (Object.keys(guildEdit).length) await guild.edit({ ...guildEdit, reason });
  } catch (error) {
    result.errors.push(`guild_settings: ${error.message}`);
  }

  for (const data of snapshot.emojis ?? []) {
    if (!data?.name) continue;
    try {
      const existing = data.id ? guild.emojis.cache.get(String(data.id)) : guild.emojis.cache.find((emoji) => emoji.name === data.name);
      if (existing) {
        await existing.edit({ name: String(data.name).slice(0, 32), reason });
        result.emojis.updated++;
      } else if (data.url) {
        await guild.emojis.create({ attachment: data.url, name: String(data.name).slice(0, 32), reason });
        result.emojis.created++;
      } else {
        result.emojis.skipped++;
      }
    } catch (error) {
      result.emojis.failed++;
      result.errors.push(`emoji:${data.name}: ${error.message}`);
    }
  }

  if (replace) {
    for (const channel of [...guild.channels.cache.values()]) {
      if (!isRestorableChannel(channel) || targetChannelIds.has(String(channel.id))) continue;
      try {
        await channel.delete(reason);
        result.deleted.channels++;
      } catch (error) {
        result.errors.push(`delete_channel:${channel.name}: ${error.message}`);
      }
    }
    for (const role of [...guild.roles.cache.values()]) {
      if (role.managed || role.id === guild.id || targetRoleIds.has(String(role.id))) continue;
      try {
        await role.delete(reason);
        result.deleted.roles++;
      } catch (error) {
        result.errors.push(`delete_role:${role.name}: ${error.message}`);
      }
    }
  }

  return result;
}

module.exports = { restoreBackup, isRestorableChannel };
