const { ChannelType } = require('discord.js');

const RESTORABLE_CHANNEL_TYPES = new Set([
  ChannelType.GuildCategory,
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
].filter((type) => type !== undefined));

// Stickers that can be uploaded again: PNG, APNG and GIF (the animated ones made with Lottie cannot).
const STICKER_FORMATS = new Set([1, 2, 4]);

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
  const text = data.type === ChannelType.GuildText || data.type === ChannelType.GuildAnnouncement || data.type === ChannelType.GuildForum;
  if (text && data.defaultAutoArchiveDuration != null) options.defaultAutoArchiveDuration = Number(data.defaultAutoArchiveDuration);
  if (data.type === ChannelType.GuildVoice || data.type === ChannelType.GuildStageVoice) {
    if (data.rtcRegion) options.rtcRegion = String(data.rtcRegion);
    if (data.videoQualityMode != null) options.videoQualityMode = Number(data.videoQualityMode);
  }
  if (data.type === ChannelType.GuildForum) {
    if (Array.isArray(data.availableTags) && data.availableTags.length) {
      options.availableTags = data.availableTags.slice(0, 20).map((tag) => ({ name: String(tag.name).slice(0, 20), moderated: Boolean(tag.moderated), emoji: tag.emojiId ? { id: String(tag.emojiId) } : tag.emojiName ? { name: String(tag.emojiName) } : undefined }));
    }
    if (data.defaultReactionEmoji) options.defaultReactionEmoji = data.defaultReactionEmoji.id ? { id: String(data.defaultReactionEmoji.id) } : { name: String(data.defaultReactionEmoji.name) };
    if (data.defaultSortOrder != null) options.defaultSortOrder = Number(data.defaultSortOrder);
    if (data.defaultForumLayout != null) options.defaultForumLayout = Number(data.defaultForumLayout);
    if (data.defaultThreadRateLimitPerUser != null) options.defaultThreadRateLimitPerUser = Number(data.defaultThreadRateLimitPerUser);
  }
  if (permissionOverwrites.length) options.permissionOverwrites = permissionOverwrites;
  return options;
}

// The parts a restore can bring back on their own ("only the roles", "only the channels"...). Everything, when none is named.
const RESTORE_PARTS = ['roles', 'channels', 'settings', 'emojis', 'stickers', 'automod'];

/** The parts asked for, as a set: a list or a text like "roles,channels". Unknown names are left out; nothing known means all of them. */
function restoreParts(parts) {
  const list = (Array.isArray(parts) ? parts : String(parts ?? '').split(/[\s,]+/)).map((part) => String(part).toLowerCase().trim()).filter((part) => RESTORE_PARTS.includes(part));
  return new Set(list.length ? list : RESTORE_PARTS);
}

/** The snapshot with only the parts asked for (the others are empty lists, and the server settings are dropped when not asked for). */
function selectParts(snapshot, only) {
  return {
    ...snapshot,
    roles: only.has('roles') ? snapshot.roles : [],
    channels: only.has('channels') ? snapshot.channels : [],
    emojis: only.has('emojis') ? snapshot.emojis ?? [] : [],
    stickers: only.has('stickers') ? snapshot.stickers ?? [] : [],
    automod: only.has('automod') ? snapshot.automod ?? [] : [],
    guild: only.has('settings') ? snapshot.guild ?? {} : null,
  };
}

/** What a backup holds, counted: roles, categories, channels, permission overwrites, emojis, stickers, automod rules and server settings. */
function backupContents(rawSnapshot) {
  const snapshot = normaliseSnapshot(rawSnapshot);
  const channels = snapshot.channels.filter((data) => data && RESTORABLE_CHANNEL_TYPES.has(data.type));
  return {
    roles: snapshot.roles.filter((data) => data?.id && !data.managed && data.name !== '@everyone' && String(data.id) !== String(snapshot.guild?.id ?? '')).length,
    categories: channels.filter((data) => data.type === ChannelType.GuildCategory).length,
    channels: channels.filter((data) => data.type !== ChannelType.GuildCategory).length,
    overwrites: channels.reduce((sum, data) => sum + (Array.isArray(data.permissionOverwrites) ? data.permissionOverwrites.length : 0), 0),
    emojis: (snapshot.emojis ?? []).length,
    stickers: (snapshot.stickers ?? []).length,
    automod: (snapshot.automod ?? []).length,
    settings: snapshot.guild ? Object.keys(snapshot.guild).filter((key) => snapshot.guild[key] !== null && snapshot.guild[key] !== undefined).length : 0,
  };
}

function normaliseSnapshot(snapshot) {
  if (!snapshot || snapshot.format !== 'petto-server-backup' || !Array.isArray(snapshot.roles) || !Array.isArray(snapshot.channels)) {
    const error = new Error('Invalid or unsupported Petto backup format.'); // i18n-ignore: internal error, never shown
    error.code = 'invalid_backup';
    throw error;
  }
  return snapshot;
}

/** The channels the restore must never delete: the ones the server needs to keep working (rules, system, updates, AFK) and any the caller names. */
function protectedChannelIds(guild, extra = []) {
  return new Set([guild.rulesChannelId, guild.systemChannelId, guild.publicUpdatesChannelId, guild.afkChannelId, ...extra].filter(Boolean).map(String));
}

/**
 * What a restore would do, without touching anything: how many roles, channels and emojis it creates or updates and, in replace mode,
 * the names of what it would delete. The command and the dashboard show it before asking to confirm.
 */
function planRestore(guild, rawSnapshot, { mode = 'merge', keepChannelIds = [], parts = null } = {}) {
  const only = restoreParts(parts);
  const snapshot = selectParts(normaliseSnapshot(rawSnapshot), only);
  const plan = {
    mode,
    parts: RESTORE_PARTS.filter((part) => only.has(part)),
    roles: { create: 0, update: 0, skip: 0 },
    channels: { create: 0, update: 0 },
    emojis: { create: 0, update: 0, skip: 0 },
    stickers: { create: 0, skip: 0 },
    automod: { create: 0, update: 0 },
    deleteRoles: [],
    deleteChannels: [],
    steps: 0,
  };
  const matchedRoles = new Set([String(guild.id)]);
  for (const data of snapshot.roles) {
    if (!data?.id || String(data.id) === String(guild.id)) continue;
    const existing = guild.roles.cache.get(String(data.id));
    if (existing?.managed) { plan.roles.skip++; matchedRoles.add(String(existing.id)); continue; }
    if (existing) { plan.roles.update++; matchedRoles.add(String(existing.id)); } else plan.roles.create++;
  }
  const matchedChannels = new Set();
  const channels = snapshot.channels.filter((data) => data && RESTORABLE_CHANNEL_TYPES.has(data.type));
  for (const data of channels) {
    const existing = findChannel(guild, data);
    if (existing) { plan.channels.update++; matchedChannels.add(String(existing.id)); } else plan.channels.create++;
  }
  for (const data of snapshot.emojis ?? []) {
    if (!data?.name) continue;
    const existing = data.id ? guild.emojis.cache.get(String(data.id)) : guild.emojis.cache.find((emoji) => emoji.name === data.name);
    if (existing) plan.emojis.update++; else if (data.url) plan.emojis.create++; else plan.emojis.skip++;
  }
  for (const data of snapshot.stickers ?? []) {
    if (!data?.name) continue;
    if (guild.stickers?.cache?.find((sticker) => sticker.name === data.name)) plan.stickers.skip++; else if (data.url && STICKER_FORMATS.has(Number(data.format))) plan.stickers.create++; else plan.stickers.skip++;
  }
  for (const data of snapshot.automod ?? []) {
    if (!data?.name) continue;
    if (guild.autoModerationRules?.cache?.find((rule) => rule.name === data.name)) plan.automod.update++; else plan.automod.create++;
  }
  // Replace only deletes in the parts it brings back: "only the channels" never deletes a role, and the other way round.
  if (mode === 'replace') {
    const keep = protectedChannelIds(guild, keepChannelIds);
    if (only.has('channels')) {
      for (const channel of guild.channels.cache.values()) {
        if (isRestorableChannel(channel) && !matchedChannels.has(String(channel.id)) && !keep.has(String(channel.id))) plan.deleteChannels.push(channel.name);
      }
    }
    if (only.has('roles')) {
      for (const role of guild.roles.cache.values()) {
        if (!role.managed && role.id !== guild.id && !matchedRoles.has(String(role.id))) plan.deleteRoles.push(role.name);
      }
    }
  }
  plan.steps = snapshot.roles.length + 1 + channels.length + 1 + (snapshot.emojis ?? []).length + (snapshot.stickers ?? []).length + (snapshot.automod ?? []).length + plan.deleteChannels.length + plan.deleteRoles.length;
  return plan;
}

/**
 * Restores a Petto snapshot into the same Discord server.
 * Merge creates or updates resources without deleting anything. Replace also
 * removes user-created channels and roles that are not present in the snapshot, and only after everything else worked.
 * `onProgress({ phase, done, total })` is told after every step; `shouldStop()` is asked before each one, and a restore that is
 * stopped leaves what it already did, deletes nothing more and says `cancelled: true`.
 */
async function restoreBackup(guild, rawSnapshot, { mode = 'merge', reason = 'Petto backup restore', onProgress = null, shouldStop = null, keepChannelIds = [], parts = null } = {}) { // i18n-ignore: default only, callers pass a translated reason
  const only = restoreParts(parts);
  const full = normaliseSnapshot(rawSnapshot);
  const snapshot = selectParts(full, only);
  const replace = mode === 'replace';
  if (!['merge', 'replace'].includes(mode)) {
    const error = new Error('Restore mode must be merge or replace.'); // i18n-ignore: internal error, never shown
    error.code = 'invalid_mode';
    throw error;
  }

  const result = {
    mode,
    cancelled: false,
    deletionSkipped: null,
    roles: { created: 0, updated: 0, skipped: 0, failed: 0 },
    channels: { created: 0, updated: 0, skipped: 0, failed: 0 },
    emojis: { created: 0, updated: 0, skipped: 0, failed: 0 },
    stickers: { created: 0, updated: 0, skipped: 0, failed: 0 },
    automod: { created: 0, updated: 0, skipped: 0, failed: 0 },
    deleted: { roles: 0, channels: 0 },
    parts: RESTORE_PARTS.filter((part) => only.has(part)),
    errors: [],
  };
  const plan = planRestore(guild, full, { mode, keepChannelIds, parts: [...only] });
  let done = 0;
  const report = (phase) => { done += 1; try { onProgress?.({ phase, done, total: plan.steps }); } catch { /* a progress listener must never stop a restore */ } };
  const stopped = () => {
    if (result.cancelled) return true;
    if (shouldStop?.()) result.cancelled = true;
    return result.cancelled;
  };
  const roleMap = new Map([[String(guild.id), String(guild.id)]]);
  const targetRoleIds = new Set([String(guild.id)]);
  // When the roles are not brought back, the channels still point their permissions at the roles that are still there.
  if (!only.has('roles')) for (const data of full.roles) if (data?.id && guild.roles.cache.has(String(data.id))) roleMap.set(String(data.id), String(data.id));

  const roles = [...snapshot.roles].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  for (const data of roles) {
    if (stopped()) return result;
    if (!data?.id || String(data.id) === String(guild.id)) { report('roles'); continue; }
    const existing = guild.roles.cache.get(String(data.id));
    if (existing?.managed) {
      result.roles.skipped++;
      report('roles');
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
      // The icon of a role needs a boosted server: it is tried on its own so that a refusal never undoes the rest.
      if (data.unicodeEmoji || data.iconURL) await role.edit({ ...(data.unicodeEmoji ? { unicodeEmoji: String(data.unicodeEmoji) } : { icon: String(data.iconURL) }), reason }).catch(() => {});
      result.roles[existing ? 'updated' : 'created']++;
    } catch (error) {
      result.roles.failed++;
      result.errors.push(`role:${data.name || data.id}: ${error.message}`);
    }
    report('roles');
  }

  if (stopped()) return result;
  try {
    const positions = roles
      .map((data) => ({ role: roleMap.get(String(data.id)), position: Number(data.position) || 1 }))
      .filter((entry) => entry.role && entry.role !== String(guild.id));
    if (positions.length) await guild.roles.setPositions(positions, { reason });
  } catch (error) {
    result.errors.push(`role_positions: ${error.message}`); // i18n-ignore: technical step name and Discord's own error text
  }
  report('roles');

  const channelMap = new Map();
  const targetChannelIds = new Set();
  // When the channels are not brought back, the settings and the automod rules point at the matching channels that are still there.
  if (!only.has('channels')) {
    for (const data of full.channels) {
      const existing = data && RESTORABLE_CHANNEL_TYPES.has(data.type) ? findChannel(guild, data) : null;
      if (existing) channelMap.set(String(data.id), String(existing.id));
    }
  }
  const channels = [...snapshot.channels]
    .filter((data) => data && RESTORABLE_CHANNEL_TYPES.has(data.type))
    .sort((a, b) => (a.type === ChannelType.GuildCategory ? -1 : 0) - (b.type === ChannelType.GuildCategory ? -1 : 0) || Number(a.position ?? 0) - Number(b.position ?? 0));

  for (const data of channels) {
    if (stopped()) return result;
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
    report('channels');
  }

  if (stopped()) return result;
  const guildData = snapshot.guild ?? {};
  // (Without the settings part, snapshot.guild is null and nothing of the server itself changes.)
  const guildEdit = {};
  if (guildData.name) guildEdit.name = String(guildData.name).slice(0, 100);
  for (const key of ['verificationLevel', 'defaultMessageNotifications', 'explicitContentFilter', 'afkTimeout']) {
    if (guildData[key] !== undefined && guildData[key] !== null) guildEdit[key] = guildData[key];
  }
  if (guildData.afkChannelId !== undefined) guildEdit.afkChannel = guildData.afkChannelId ? channelMap.get(String(guildData.afkChannelId)) ?? null : null;
  if (guildData.systemChannelId !== undefined) guildEdit.systemChannel = guildData.systemChannelId ? channelMap.get(String(guildData.systemChannelId)) ?? null : null;
  if (guildData.rulesChannelId !== undefined) guildEdit.rulesChannel = guildData.rulesChannelId ? channelMap.get(String(guildData.rulesChannelId)) ?? null : null;
  if (guildData.publicUpdatesChannelId !== undefined) guildEdit.publicUpdatesChannel = guildData.publicUpdatesChannelId ? channelMap.get(String(guildData.publicUpdatesChannelId)) ?? null : null;
  if (guildData.description != null) guildEdit.description = guildData.description ? String(guildData.description).slice(0, 120) : null;
  if (guildData.preferredLocale) guildEdit.preferredLocale = guildData.preferredLocale;
  if (guildData.premiumProgressBarEnabled != null) guildEdit.premiumProgressBarEnabled = Boolean(guildData.premiumProgressBarEnabled);
  if (guildData.systemChannelFlags != null) guildEdit.systemChannelFlags = Number(guildData.systemChannelFlags);
  if (guildData.safetyAlertsChannelId !== undefined) guildEdit.safetyAlertsChannel = guildData.safetyAlertsChannelId ? channelMap.get(String(guildData.safetyAlertsChannelId)) ?? null : null;
  if (guildData.iconURL) guildEdit.icon = guildData.iconURL;
  if (guildData.bannerURL) guildEdit.banner = guildData.bannerURL;
  try {
    if (Object.keys(guildEdit).length) await guild.edit({ ...guildEdit, reason });
  } catch (error) {
    result.errors.push(`guild_settings: ${error.message}`); // i18n-ignore: technical step name and Discord's own error text
  }
  report('settings');

  for (const data of snapshot.emojis ?? []) {
    if (stopped()) return result;
    if (!data?.name) { report('emojis'); continue; }
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
    report('emojis');
  }

  for (const data of snapshot.stickers ?? []) {
    if (stopped()) return result;
    if (!data?.name) { report('stickers'); continue; }
    try {
      if (guild.stickers?.cache?.find((sticker) => sticker.name === data.name) || !data.url || !STICKER_FORMATS.has(Number(data.format))) {
        result.stickers.skipped++;
      } else {
        await guild.stickers.create({ file: data.url, name: String(data.name).slice(0, 30), tags: String(data.tags || 'sticker').slice(0, 200), description: data.description ? String(data.description).slice(0, 100) : undefined, reason });
        result.stickers.created++;
      }
    } catch (error) {
      result.stickers.failed++;
      result.errors.push(`sticker:${data.name}: ${error.message}`);
    }
    report('stickers');
  }

  for (const data of snapshot.automod ?? []) {
    if (stopped()) return result;
    if (!data?.name) { report('automod'); continue; }
    try {
      const mapChannel = (id) => channelMap.get(String(id)) ?? (guild.channels.cache.has(String(id)) ? String(id) : null);
      const mapRole = (id) => roleMap.get(String(id)) ?? (guild.roles.cache.has(String(id)) ? String(id) : null);
      const options = {
        name: String(data.name).slice(0, 100),
        eventType: data.eventType,
        triggerType: data.triggerType,
        triggerMetadata: data.triggerMetadata ?? {},
        actions: (data.actions ?? []).map((action) => {
          const metadata = { ...(action.metadata ?? {}) };
          if (metadata.channelId) metadata.channel = mapChannel(metadata.channelId);
          delete metadata.channelId;
          return { type: action.type, metadata };
        }).filter((action) => !(action.metadata.channel === null && 'channel' in action.metadata)),
        enabled: Boolean(data.enabled),
        exemptRoles: (data.exemptRoles ?? []).map(mapRole).filter(Boolean),
        exemptChannels: (data.exemptChannels ?? []).map(mapChannel).filter(Boolean),
        reason,
      };
      const existing = guild.autoModerationRules?.cache?.find((rule) => rule.name === data.name);
      if (existing) { await existing.edit(options); result.automod.updated++; } else { await guild.autoModerationRules.create(options); result.automod.created++; }
    } catch (error) {
      result.automod.failed++;
      result.errors.push(`automod:${data.name}: ${error.message}`);
    }
    report('automod');
  }

  if (replace) {
    // Nothing is deleted unless everything above was put back: a channel or role that could not be created would be lost for good.
    if (result.roles.failed || result.channels.failed) {
      result.deletionSkipped = 'failures';
      return result;
    }
    const keep = protectedChannelIds(guild, keepChannelIds);
    for (const channel of only.has('channels') ? [...guild.channels.cache.values()] : []) {
      if (!isRestorableChannel(channel) || targetChannelIds.has(String(channel.id)) || keep.has(String(channel.id))) continue;
      if (stopped()) return result;
      try {
        await channel.delete(reason);
        result.deleted.channels++;
      } catch (error) {
        result.errors.push(`delete_channel:${channel.name}: ${error.message}`); // i18n-ignore: technical step name and Discord's own error text
      }
      report('cleanup');
    }
    for (const role of only.has('roles') ? [...guild.roles.cache.values()] : []) {
      if (role.managed || role.id === guild.id || targetRoleIds.has(String(role.id))) continue;
      if (stopped()) return result;
      try {
        await role.delete(reason);
        result.deleted.roles++;
      } catch (error) {
        result.errors.push(`delete_role:${role.name}: ${error.message}`); // i18n-ignore: technical step name and Discord's own error text
      }
      report('cleanup');
    }
  }

  return result;
}

module.exports = { restoreBackup, planRestore, isRestorableChannel, restoreParts, backupContents, RESTORE_PARTS };
