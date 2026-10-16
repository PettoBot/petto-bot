// Formats role, channel, invite, and guild changes for the audit-log engine.
const { PermissionsBitField } = require('discord.js');
const { sendLog, getAvatar, fetchMod, prettyPermission, AuditLogEvent } = require('./engine');
const logger = require('../utils/logger');
const { t, guildLanguage, currentLanguage } = require('../i18n');
const { permissionName } = require('../utils/permissionLabels');

// English keeps the names it always had ("Manage Guild"); the other languages use the translated names of the permissions.
const permissionLabel = (flag, lang) => (lang === 'en' ? prettyPermission(flag) : permissionName(flag, lang));

/** The permissions in `a` that are not in `b`, by name. (`BitField#remove` changes the bitfield it is called on, so it is not used.) */
const only = (a, b, lang) => new PermissionsBitField(a.bitfield & ~b.bitfield).toArray().map((flag) => permissionLabel(flag, lang));

const CHANNEL_TYPES = {
  0: 'text', 2: 'voice', 4: 'category', 5: 'announcement',
  10: 'announcementThread', 11: 'publicThread', 12: 'privateThread',
  13: 'stage', 15: 'forum', 16: 'media',
};
const channelType = (type, lang) => (CHANNEL_TYPES[type] ? t(lang, `logs.channelType.${CHANNEL_TYPES[type]}`) : t(lang, 'logs.unknown'));
// `true` / `false` as Discord shows a setting, in the language of the server.
const bool = (value, lang) => `\`${t(lang, value ? 'logs.true' : 'logs.false')}\``;

async function handleRoleCreate(role, client) {
  const lang = await guildLanguage(role.guild.id);
  const mod = await fetchMod(role.guild, AuditLogEvent.RoleCreate, role.id);
  const fields = [
    { name: t(lang, 'logs.field.name'), value: role.name, inline: true },
    { name: t(lang, 'logs.field.color'), value: `\`#${role.color.toString(16).padStart(6, '0')}\``, inline: true },
  ];
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });

  await sendLog(client, role.guild.id, 'roles', {
    author: { name: t(lang, 'logs.role.created.title') },
    description: t(lang, 'logs.role.created.description', { role: `<@&${role.id}>` }),
    fields,
    footer: { text: t(lang, 'logs.role.footer', { id: role.id }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleRoleDelete(role, client) {
  const lang = await guildLanguage(role.guild.id);
  const mod = await fetchMod(role.guild, AuditLogEvent.RoleDelete, role.id);
  const fields = mod ? [{ name: t(lang, 'logs.field.by'), value: mod, inline: true }] : [];

  await sendLog(client, role.guild.id, 'roles', {
    author: { name: t(lang, 'logs.role.deleted.title') },
    description: t(lang, 'logs.role.deleted.description', { name: role.name }),
    fields,
    footer: { text: t(lang, 'logs.role.footer', { id: role.id }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleRoleUpdate(oldRole, newRole, client) {
  const lang = await guildLanguage(newRole.guild.id);
  const none = t(lang, 'logs.noneItalic');
  const fields = [];
  if (oldRole.name !== newRole.name) fields.push({ name: t(lang, 'logs.field.name'), value: `\`${oldRole.name}\` -> \`${newRole.name}\``, inline: false });
  if (oldRole.color !== newRole.color)
    fields.push({ name: t(lang, 'logs.field.color'), value: `\`#${oldRole.color.toString(16).padStart(6, '0')}\` -> \`#${newRole.color.toString(16).padStart(6, '0')}\``, inline: false });
  if (oldRole.hoist !== newRole.hoist) fields.push({ name: t(lang, 'logs.role.hoist'), value: `${bool(oldRole.hoist, lang)} -> ${bool(newRole.hoist, lang)}`, inline: true });
  if (oldRole.mentionable !== newRole.mentionable) fields.push({ name: t(lang, 'logs.role.mentionable'), value: `${bool(oldRole.mentionable, lang)} -> ${bool(newRole.mentionable, lang)}`, inline: true });
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
    const granted = only(newRole.permissions, oldRole.permissions, lang);
    const revoked = only(oldRole.permissions, newRole.permissions, lang);
    if (granted.length) fields.push({ name: t(lang, 'logs.role.permissionsGranted'), value: granted.map((p) => `\`${p}\``).join(', '), inline: false });
    if (revoked.length) fields.push({ name: t(lang, 'logs.role.permissionsRemoved'), value: revoked.map((p) => `\`${p}\``).join(', '), inline: false });
  }
  if (oldRole.icon !== newRole.icon) fields.push({ name: t(lang, 'logs.field.icon'), value: t(lang, newRole.icon ? 'logs.role.iconChanged' : 'logs.role.iconRemoved'), inline: false });
  if ((oldRole.unicodeEmoji ?? null) !== (newRole.unicodeEmoji ?? null)) fields.push({ name: t(lang, 'logs.field.emoji'), value: `${oldRole.unicodeEmoji || none} -> ${newRole.unicodeEmoji || none}`, inline: true });
  if (!fields.length) return;

  const mod = await fetchMod(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });

  await sendLog(client, newRole.guild.id, 'roles', {
    author: { name: t(lang, 'logs.role.updated.title') },
    description: t(lang, 'logs.role.updated.description', { role: `<@&${newRole.id}>` }),
    fields,
    footer: { text: t(lang, 'logs.role.footer', { id: newRole.id }) },
    timestamp: new Date().toISOString(),
  });
}

function channelFields(channel, mod, lang) {
  const fields = [
    { name: t(lang, 'logs.field.type'), value: channelType(channel.type, lang), inline: true },
    { name: t(lang, 'logs.field.category'), value: channel.parent?.name || t(lang, 'logs.none'), inline: true },
  ];
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });
  return fields;
}

async function handleChannelCreate(channel, client) {
  if (!channel.guild) return;
  const lang = await guildLanguage(channel.guild.id);
  const mod = await fetchMod(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

  await sendLog(
    client,
    channel.guild.id,
    'channels',
    {
      author: { name: t(lang, 'logs.channel.created.title') },
      description: t(lang, 'logs.channel.created.description', { channel: `<#${channel.id}>`, name: channel.name }),
      fields: channelFields(channel, mod, lang),
      footer: { text: t(lang, 'logs.channel.footer', { id: channel.id }) },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [channel.id] },
  );
}

async function handleChannelDelete(channel, client) {
  if (!channel.guild) return;
  const lang = await guildLanguage(channel.guild.id);
  const mod = await fetchMod(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

  await sendLog(client, channel.guild.id, 'channels', {
    author: { name: t(lang, 'logs.channel.deleted.title') },
    description: t(lang, 'logs.channel.deleted.description', { name: channel.name }),
    fields: channelFields(channel, mod, lang),
    footer: { text: t(lang, 'logs.channel.footer', { id: channel.id }) },
    timestamp: new Date().toISOString(),
  });
}

// The @everyone role is shown as plain text: Discord draws a mention of it as `@@everyone`.
const who = (overwrite) => (overwrite.id === overwrite.channel?.guild?.id ? '`@everyone`' : overwrite.type === 0 ? `<@&${overwrite.id}>` : `<@${overwrite.id}>`);

/** "allowed X; denied Y" for what one overwrite allows and denies that the other did not. */
function grantedParts(allow, deny, previousAllow, previousDeny, lang) {
  const parts = [];
  const allowed = only(allow, previousAllow, lang);
  const denied = only(deny, previousDeny, lang);
  if (allowed.length) parts.push(t(lang, 'logs.channel.overwrite.allowed', { permissions: allowed.join(', ') }));
  if (denied.length) parts.push(t(lang, 'logs.channel.overwrite.denied', { permissions: denied.join(', ') }));
  return parts;
}

/** The permission overwrites of a channel that were added (with what they allow and deny), removed or changed, one line each. */
function overwriteChanges(oldChannel, newChannel, lang = currentLanguage()) {
  const before = oldChannel.permissionOverwrites?.cache;
  const after = newChannel.permissionOverwrites?.cache;
  if (!before || !after) return [];
  const lines = [];
  const nothing = new PermissionsBitField(0n);
  for (const overwrite of after.values()) {
    const previous = before.get(overwrite.id);
    if (!previous) {
      const parts = grantedParts(overwrite.allow, overwrite.deny, nothing, nothing, lang);
      const added = t(lang, 'logs.channel.overwrite.added', { target: who(overwrite) });
      lines.push(parts.length ? `${added}: ${parts.join('; ')}` : added);
    } else if (previous.allow.bitfield !== overwrite.allow.bitfield || previous.deny.bitfield !== overwrite.deny.bitfield) {
      const allowed = only(overwrite.allow, previous.allow, lang);
      const denied = only(overwrite.deny, previous.deny, lang);
      const reset = only(previous.allow, overwrite.allow, lang).concat(only(previous.deny, overwrite.deny, lang)).filter((name) => !allowed.includes(name) && !denied.includes(name));
      const parts = [];
      if (allowed.length) parts.push(t(lang, 'logs.channel.overwrite.allowed', { permissions: allowed.join(', ') }));
      if (denied.length) parts.push(t(lang, 'logs.channel.overwrite.denied', { permissions: denied.join(', ') }));
      if (reset.length) parts.push(t(lang, 'logs.channel.overwrite.reset', { permissions: reset.join(', ') }));
      lines.push(`${who(overwrite)}: ${parts.join('; ') || t(lang, 'logs.channel.overwrite.changed')}`);
    }
  }
  for (const overwrite of before.values()) if (!after.has(overwrite.id)) lines.push(t(lang, 'logs.channel.overwrite.removed', { target: who(overwrite) }));
  return lines;
}

// What a channel has besides its name and permissions: the voice region and video quality, the defaults of forums and of their threads, the
// forum tags and the status of a voice channel. Each one is only told when it changed.
const SORT_ORDERS = { 0: 'latest', 1: 'created' };
const FORUM_LAYOUTS = { 0: 'none', 1: 'list', 2: 'gallery' };
const emojiOf = (reaction) => (reaction?.emojiId ? `<:${reaction.emojiName ?? '_'}:${reaction.emojiId}>` : reaction?.emojiName ?? null);

function channelExtras(oldChannel, newChannel, lang) {
  const fields = [];
  const none = t(lang, 'logs.noneItalic');
  const change = (name, before, after) => fields.push({ name: t(lang, name), value: `${before} -> ${after}`, inline: true });
  if ('rtcRegion' in newChannel && (oldChannel.rtcRegion ?? null) !== (newChannel.rtcRegion ?? null)) {
    const automatic = t(lang, 'logs.channel.automatic');
    change('logs.channel.rtcRegion', oldChannel.rtcRegion ?? automatic, newChannel.rtcRegion ?? automatic);
  }
  if ('videoQualityMode' in newChannel && (oldChannel.videoQualityMode ?? null) !== (newChannel.videoQualityMode ?? null)) {
    const quality = (mode) => t(lang, mode === 2 ? 'logs.channel.video.full' : 'logs.channel.video.auto');
    change('logs.channel.videoQuality', quality(oldChannel.videoQualityMode), quality(newChannel.videoQualityMode));
  }
  if ('defaultAutoArchiveDuration' in newChannel && (oldChannel.defaultAutoArchiveDuration ?? null) !== (newChannel.defaultAutoArchiveDuration ?? null)) {
    const minutes = (value) => (value ? `${value} min` : none);
    change('logs.channel.defaultArchive', minutes(oldChannel.defaultAutoArchiveDuration), minutes(newChannel.defaultAutoArchiveDuration));
  }
  if ('defaultThreadRateLimitPerUser' in newChannel && (oldChannel.defaultThreadRateLimitPerUser ?? 0) !== (newChannel.defaultThreadRateLimitPerUser ?? 0)) {
    change('logs.channel.defaultThreadSlowmode', `${oldChannel.defaultThreadRateLimitPerUser ?? 0}s`, `${newChannel.defaultThreadRateLimitPerUser ?? 0}s`);
  }
  if ('defaultReactionEmoji' in newChannel && emojiOf(oldChannel.defaultReactionEmoji) !== emojiOf(newChannel.defaultReactionEmoji)) {
    change('logs.channel.defaultReaction', emojiOf(oldChannel.defaultReactionEmoji) ?? none, emojiOf(newChannel.defaultReactionEmoji) ?? none);
  }
  if ('defaultSortOrder' in newChannel && (oldChannel.defaultSortOrder ?? null) !== (newChannel.defaultSortOrder ?? null)) {
    const sort = (value) => (SORT_ORDERS[value] ? t(lang, `logs.channel.sort.${SORT_ORDERS[value]}`) : none);
    change('logs.channel.defaultSort', sort(oldChannel.defaultSortOrder), sort(newChannel.defaultSortOrder));
  }
  if ('defaultForumLayout' in newChannel && (oldChannel.defaultForumLayout ?? null) !== (newChannel.defaultForumLayout ?? null)) {
    const layout = (value) => t(lang, `logs.channel.layout.${FORUM_LAYOUTS[value] ?? 'none'}`);
    change('logs.channel.defaultLayout', layout(oldChannel.defaultForumLayout), layout(newChannel.defaultForumLayout));
  }
  if (Array.isArray(newChannel.availableTags)) {
    const before = new Map((oldChannel.availableTags ?? []).map((tag) => [tag.id, tag.name]));
    const after = new Map(newChannel.availableTags.map((tag) => [tag.id, tag.name]));
    const lines = [];
    for (const [id, name] of after) if (!before.has(id)) lines.push(`+ ${name}`);
    for (const [id, name] of before) if (!after.has(id)) lines.push(`- ${name}`);
    for (const [id, name] of after) if (before.has(id) && before.get(id) !== name) lines.push(`${before.get(id)} -> ${name}`);
    if (lines.length) fields.push({ name: t(lang, 'logs.channel.tags'), value: lines.join('\n').slice(0, 1000), inline: false });
  }
  if ('status' in newChannel && (oldChannel.status ?? null) !== (newChannel.status ?? null)) {
    change('logs.channel.voiceStatus', oldChannel.status || none, newChannel.status || none);
  }
  return fields;
}

async function reportChannelUpdate(oldChannel, newChannel, client) {
  if (!oldChannel.guild) return;
  const lang = await guildLanguage(newChannel.guild.id);
  const none = t(lang, 'logs.none');
  const noneItalic = t(lang, 'logs.noneItalic');
  const unlimited = t(lang, 'logs.channel.unlimited');
  const fields = [];
  if (oldChannel.name !== newChannel.name) fields.push({ name: t(lang, 'logs.field.name'), value: `\`${oldChannel.name}\` -> \`${newChannel.name}\``, inline: false });
  if (oldChannel.topic !== newChannel.topic) fields.push({ name: t(lang, 'logs.field.topic'), value: `${oldChannel.topic || noneItalic} -> ${newChannel.topic || noneItalic}`, inline: false });
  if (oldChannel.parentId !== newChannel.parentId)
    fields.push({ name: t(lang, 'logs.field.category'), value: `${oldChannel.parent?.name || none} -> ${newChannel.parent?.name || none}`, inline: false });
  if (Boolean(oldChannel.nsfw) !== Boolean(newChannel.nsfw)) fields.push({ name: t(lang, 'logs.channel.ageRestricted'), value: `${bool(Boolean(oldChannel.nsfw), lang)} -> ${bool(Boolean(newChannel.nsfw), lang)}`, inline: true });
  if ((oldChannel.rateLimitPerUser ?? 0) !== (newChannel.rateLimitPerUser ?? 0)) fields.push({ name: t(lang, 'logs.field.slowmode'), value: `${oldChannel.rateLimitPerUser ?? 0}s -> ${newChannel.rateLimitPerUser ?? 0}s`, inline: true });
  if ((oldChannel.bitrate ?? null) !== (newChannel.bitrate ?? null) && newChannel.bitrate) fields.push({ name: t(lang, 'logs.channel.bitrate'), value: `${Math.round((oldChannel.bitrate ?? 0) / 1000)} kbps -> ${Math.round(newChannel.bitrate / 1000)} kbps`, inline: true }); // i18n-ignore: units
  if ((oldChannel.userLimit ?? null) !== (newChannel.userLimit ?? null) && newChannel.userLimit !== undefined) fields.push({ name: t(lang, 'logs.channel.userLimit'), value: `${oldChannel.userLimit || unlimited} -> ${newChannel.userLimit || unlimited}`, inline: true });
  fields.push(...channelExtras(oldChannel, newChannel, lang));
  const overwrites = overwriteChanges(oldChannel, newChannel, lang);
  if (overwrites.length) fields.push({ name: t(lang, 'logs.field.permissions'), value: overwrites.join('\n').slice(0, 1000), inline: false });
  if (!fields.length) return;

  // Changing permissions is a different audit log action than changing the channel itself.
  const actions = overwrites.length ? [AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteDelete, AuditLogEvent.ChannelUpdate] : [AuditLogEvent.ChannelUpdate];
  let mod = null;
  for (const action of actions) {
    mod = await fetchMod(newChannel.guild, action, newChannel.id);
    if (mod) break;
  }
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });

  await sendLog(
    client,
    newChannel.guild.id,
    'channels',
    {
      author: { name: t(lang, 'logs.channel.updated.title') },
      description: t(lang, 'logs.channel.updated.description', { channel: `<#${newChannel.id}>` }),
      fields,
      footer: { text: t(lang, 'logs.channel.footer', { id: newChannel.id }) },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [newChannel.id] },
  );
}

// Changing several permissions of a channel makes Discord send one update for each of them, a few moments apart. They are held for a short
// time and told as one: the channel as it was before the first change against the channel as it is after the last one, so the log has one
// message with everything that changed (and who did it) instead of one for each permission.
const CHANNEL_UPDATE_WAIT_MS = 2500;
const CHANNEL_UPDATE_MAX_MS = 12_000;
const pendingChannelUpdates = new Map();

function handleChannelUpdate(oldChannel, newChannel, client, { waitMs = CHANNEL_UPDATE_WAIT_MS, maxMs = CHANNEL_UPDATE_MAX_MS } = {}) {
  if (!oldChannel.guild) return Promise.resolve();
  if (waitMs <= 0) return reportChannelUpdate(oldChannel, newChannel, client);
  return new Promise((resolve) => {
    const key = newChannel.id;
    const held = pendingChannelUpdates.get(key);
    const entry = held ?? { before: oldChannel, startedAt: Date.now(), resolvers: [] };
    entry.after = newChannel;
    entry.client = client;
    entry.resolvers.push(resolve);
    clearTimeout(entry.timer);
    const left = Math.max(0, maxMs - (Date.now() - entry.startedAt));
    entry.timer = setTimeout(async () => {
      pendingChannelUpdates.delete(key);
      try { await reportChannelUpdate(entry.before, entry.after, entry.client); } catch (error) { logger.error('[channelUpdate]', error); }
      for (const done of entry.resolvers) done();
    }, Math.min(waitMs, left));
    entry.timer.unref?.();
    pendingChannelUpdates.set(key, entry);
  });
}

async function handleInviteCreate(invite, client) {
  if (!invite.guild) return;
  const lang = await guildLanguage(invite.guild.id);
  const inviter = invite.inviter;
  const fields = [
    { name: t(lang, 'logs.field.code'), value: `discord.gg/${invite.code}`, inline: true },
    { name: t(lang, 'logs.field.channel'), value: `<#${invite.channelId}>`, inline: true },
    { name: t(lang, 'logs.invite.createdBy'), value: inviter ? `<@${inviter.id}>` : t(lang, 'logs.unknownItalic'), inline: true },
  ];
  if (invite.maxAge) {
    fields.push({ name: t(lang, 'logs.invite.expires'), value: `<t:${Math.floor(Date.now() / 1000) + invite.maxAge}:R>`, inline: true });
  }

  await sendLog(client, invite.guild.id, 'invites', {
    author: { name: t(lang, 'logs.invite.created.title'), icon_url: inviter ? getAvatar(inviter) ?? undefined : undefined },
    description: t(lang, 'logs.invite.created.description', { channel: `<#${invite.channelId}>` }),
    fields,
    footer: { text: t(lang, 'logs.invite.footer', { code: invite.code }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleInviteDelete(invite, client) {
  if (!invite.guild) return;
  const lang = await guildLanguage(invite.guild.id);
  await sendLog(client, invite.guild.id, 'invites', {
    author: { name: t(lang, 'logs.invite.deleted.title') },
    description: t(lang, 'logs.invite.deleted.description', { channel: `<#${invite.channelId}>` }),
    fields: [{ name: t(lang, 'logs.field.code'), value: `discord.gg/${invite.code}`, inline: true }],
    footer: { text: t(lang, 'logs.invite.footer', { code: invite.code }) },
    timestamp: new Date().toISOString(),
  });
}

// The settings of a server by their number in Discord: the key of each name in the catalog.
const LEVEL_NAMES = {
  verification: { 0: 'none', 1: 'low', 2: 'medium', 3: 'high', 4: 'veryHigh' },
  filter: { 0: 'off', 1: 'withoutRoles', 2: 'allMembers' },
  notifications: { 0: 'allMessages', 1: 'onlyMentions' },
};
const levelName = (kind, value, lang) => (LEVEL_NAMES[kind][value] !== undefined ? t(lang, `logs.server.${kind}.${LEVEL_NAMES[kind][value]}`) : value);
const SERVER_CHANNELS = [['systemChannelId', 'systemChannel'], ['rulesChannelId', 'rulesChannel'], ['publicUpdatesChannelId', 'updatesChannel'], ['afkChannelId', 'afkChannel']];

async function handleGuildUpdate(oldGuild, newGuild, client) {
  const lang = await guildLanguage(newGuild.id);
  const none = t(lang, 'logs.noneItalic');
  const fields = [];
  if (oldGuild.name !== newGuild.name) fields.push({ name: t(lang, 'logs.field.name'), value: `\`${oldGuild.name}\` -> \`${newGuild.name}\``, inline: false });
  if (oldGuild.icon !== newGuild.icon) fields.push({ name: t(lang, 'logs.field.icon'), value: t(lang, 'logs.server.iconChanged'), inline: false });
  if (oldGuild.banner !== newGuild.banner) fields.push({ name: t(lang, 'logs.server.banner'), value: t(lang, 'logs.server.bannerChanged'), inline: false });
  if (oldGuild.description !== newGuild.description)
    fields.push({ name: t(lang, 'logs.field.description'), value: `${oldGuild.description || none} -> ${newGuild.description || none}`, inline: false });
  if ((oldGuild.vanityURLCode ?? null) !== (newGuild.vanityURLCode ?? null)) fields.push({ name: t(lang, 'logs.server.vanityUrl'), value: `${oldGuild.vanityURLCode ? `discord.gg/${oldGuild.vanityURLCode}` : none} -> ${newGuild.vanityURLCode ? `discord.gg/${newGuild.vanityURLCode}` : none}`, inline: false });
  if (Boolean(oldGuild.widgetEnabled) !== Boolean(newGuild.widgetEnabled)) fields.push({ name: t(lang, 'logs.server.widget'), value: t(lang, newGuild.widgetEnabled ? 'logs.server.enabled' : 'logs.server.disabled'), inline: true });
  if (oldGuild.premiumTier !== newGuild.premiumTier) fields.push({ name: t(lang, 'logs.server.boostLevel'), value: `${oldGuild.premiumTier} -> ${newGuild.premiumTier}`, inline: true });
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) fields.push({ name: t(lang, 'logs.server.verificationLevel'), value: `${levelName('verification', oldGuild.verificationLevel, lang)} -> ${levelName('verification', newGuild.verificationLevel, lang)}`, inline: false });
  if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) fields.push({ name: t(lang, 'logs.server.contentFilter'), value: `${levelName('filter', oldGuild.explicitContentFilter, lang)} -> ${levelName('filter', newGuild.explicitContentFilter, lang)}`, inline: false });
  if (oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications) fields.push({ name: t(lang, 'logs.server.defaultNotifications'), value: `${levelName('notifications', oldGuild.defaultMessageNotifications, lang)} -> ${levelName('notifications', newGuild.defaultMessageNotifications, lang)}`, inline: false });
  if (oldGuild.mfaLevel !== newGuild.mfaLevel) fields.push({ name: t(lang, 'logs.server.mfa'), value: t(lang, newGuild.mfaLevel ? 'logs.server.required' : 'logs.server.notRequired'), inline: true });
  for (const [key, label] of SERVER_CHANNELS) {
    if ((oldGuild[key] ?? null) !== (newGuild[key] ?? null)) fields.push({ name: t(lang, `logs.server.${label}`), value: `${oldGuild[key] ? `<#${oldGuild[key]}>` : none} -> ${newGuild[key] ? `<#${newGuild[key]}>` : none}`, inline: false });
  }
  if (oldGuild.afkTimeout !== newGuild.afkTimeout) fields.push({ name: t(lang, 'logs.server.afkTimeout'), value: `${oldGuild.afkTimeout / 60} min -> ${newGuild.afkTimeout / 60} min`, inline: true }); // i18n-ignore: units
  if (Boolean(oldGuild.premiumProgressBarEnabled) !== Boolean(newGuild.premiumProgressBarEnabled)) fields.push({ name: t(lang, 'logs.server.progressBar'), value: t(lang, newGuild.premiumProgressBarEnabled ? 'logs.server.enabled' : 'logs.server.disabled'), inline: true });
  if (oldGuild.splash !== newGuild.splash) fields.push({ name: t(lang, 'logs.server.splash'), value: t(lang, 'logs.server.imageChanged'), inline: true });
  if (oldGuild.discoverySplash !== newGuild.discoverySplash) fields.push({ name: t(lang, 'logs.server.discoverySplash'), value: t(lang, 'logs.server.imageChanged'), inline: true });
  if ((oldGuild.ownerId ?? null) !== (newGuild.ownerId ?? null)) fields.push({ name: t(lang, 'logs.server.owner'), value: `${oldGuild.ownerId ? `<@${oldGuild.ownerId}>` : none} -> ${newGuild.ownerId ? `<@${newGuild.ownerId}>` : none}`, inline: true });
  for (const [key, label] of [['widgetChannelId', 'widgetChannel'], ['safetyAlertsChannelId', 'safetyChannel']]) {
    if ((oldGuild[key] ?? null) !== (newGuild[key] ?? null)) fields.push({ name: t(lang, `logs.server.${label}`), value: `${oldGuild[key] ? `<#${oldGuild[key]}>` : none} -> ${newGuild[key] ? `<#${newGuild[key]}>` : none}`, inline: true });
  }
  {
    const before = new Set(oldGuild.features ?? []);
    const after = new Set(newGuild.features ?? []);
    const lines = [...after].filter((name) => !before.has(name)).map((name) => `+ ${name}`).concat([...before].filter((name) => !after.has(name)).map((name) => `- ${name}`));
    if (lines.length) fields.push({ name: t(lang, 'logs.server.features'), value: lines.join('\n').slice(0, 1000), inline: false });
  }
  if (oldGuild.preferredLocale !== newGuild.preferredLocale) fields.push({ name: t(lang, 'logs.server.language'), value: `${oldGuild.preferredLocale} -> ${newGuild.preferredLocale}`, inline: true });
  if (!fields.length) return;

  const mod = await fetchMod(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });

  const embed = {
    author: { name: t(lang, 'logs.server.updated.title'), icon_url: newGuild.iconURL({ extension: 'png', size: 256 }) ?? undefined },
    description: t(lang, 'logs.server.updated.description', { name: newGuild.name }),
    fields,
    footer: { text: t(lang, 'logs.server.footer', { id: newGuild.id }) },
    timestamp: new Date().toISOString(),
  };

  if (oldGuild.icon !== newGuild.icon && newGuild.iconURL()) {
    embed.image = { url: newGuild.iconURL({ extension: 'png', size: 512 }) };
  }

  await sendLog(client, newGuild.id, 'server', embed);
}

const EVENT_STATUS = { 1: 'scheduled', 2: 'active', 3: 'completed', 4: 'canceled' };
const eventStatus = (status, lang) => (EVENT_STATUS[status] ? t(lang, `logs.event.status.${EVENT_STATUS[status]}`) : '?');

function scheduledEventFields(event, lang) {
  const fields = [];
  if (event.scheduledStartTimestamp) fields.push({ name: t(lang, 'logs.event.starts'), value: `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:F>`, inline: true });
  if (event.scheduledEndTimestamp) fields.push({ name: t(lang, 'logs.event.ends'), value: `<t:${Math.floor(event.scheduledEndTimestamp / 1000)}:F>`, inline: true });
  const where = event.channelId ? `<#${event.channelId}>` : event.entityMetadata?.location;
  if (where) fields.push({ name: t(lang, 'logs.event.where'), value: where, inline: true });
  if (event.description) fields.push({ name: t(lang, 'logs.field.description'), value: event.description.slice(0, 300), inline: false });
  return fields;
}

async function handleScheduledEventCreate(event, client) {
  if (!event.guild) return;
  const lang = await guildLanguage(event.guild.id);
  const fields = scheduledEventFields(event, lang);
  const by = event.creatorId ? `<@${event.creatorId}>` : await fetchMod(event.guild, AuditLogEvent.GuildScheduledEventCreate, event.id);
  if (by) fields.push({ name: t(lang, 'logs.field.by'), value: by, inline: true });
  await sendLog(client, event.guild.id, 'server', {
    author: { name: t(lang, 'logs.event.created.title') },
    description: t(lang, 'logs.event.created.description', { name: event.name }),
    fields,
    footer: { text: t(lang, 'logs.event.footer', { id: event.id }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleScheduledEventDelete(event, client) {
  if (!event.guild) return;
  const lang = await guildLanguage(event.guild.id);
  const mod = await fetchMod(event.guild, AuditLogEvent.GuildScheduledEventDelete, event.id);
  const fields = scheduledEventFields(event, lang);
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });
  await sendLog(client, event.guild.id, 'server', {
    author: { name: t(lang, 'logs.event.deleted.title') },
    description: t(lang, 'logs.event.deleted.description', { name: event.name }),
    fields,
    footer: { text: t(lang, 'logs.event.footer', { id: event.id }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleScheduledEventUpdate(oldEvent, newEvent, client) {
  if (!newEvent.guild || !oldEvent) return;
  const lang = await guildLanguage(newEvent.guild.id);
  const fields = [];
  if (oldEvent.name !== newEvent.name) fields.push({ name: t(lang, 'logs.field.name'), value: `\`${oldEvent.name}\` -> \`${newEvent.name}\``, inline: false });
  if (oldEvent.status !== newEvent.status) fields.push({ name: t(lang, 'logs.field.status'), value: `${eventStatus(oldEvent.status, lang)} -> ${eventStatus(newEvent.status, lang)}`, inline: true });
  if (oldEvent.scheduledStartTimestamp !== newEvent.scheduledStartTimestamp && newEvent.scheduledStartTimestamp) fields.push({ name: t(lang, 'logs.event.starts'), value: `<t:${Math.floor(newEvent.scheduledStartTimestamp / 1000)}:F>`, inline: true });
  if ((oldEvent.description ?? '') !== (newEvent.description ?? '')) fields.push({ name: t(lang, 'logs.field.description'), value: t(lang, 'logs.event.descriptionChanged'), inline: true });
  if ((oldEvent.channelId ?? oldEvent.entityMetadata?.location) !== (newEvent.channelId ?? newEvent.entityMetadata?.location)) fields.push({ name: t(lang, 'logs.event.where'), value: newEvent.channelId ? `<#${newEvent.channelId}>` : newEvent.entityMetadata?.location ?? t(lang, 'logs.none'), inline: true });
  if (!fields.length) return;
  const mod = await fetchMod(newEvent.guild, AuditLogEvent.GuildScheduledEventUpdate, newEvent.id);
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });
  await sendLog(client, newEvent.guild.id, 'server', {
    author: { name: t(lang, 'logs.event.updated.title') },
    description: t(lang, 'logs.event.updated.description', { name: newEvent.name }),
    fields,
    footer: { text: t(lang, 'logs.event.footer', { id: newEvent.id }) },
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  overwriteChanges,
  handleScheduledEventCreate, handleScheduledEventDelete, handleScheduledEventUpdate,
  handleRoleCreate, handleRoleDelete, handleRoleUpdate,
  handleChannelCreate, handleChannelDelete, handleChannelUpdate,
  handleInviteCreate, handleInviteDelete,
  handleGuildUpdate,
};
