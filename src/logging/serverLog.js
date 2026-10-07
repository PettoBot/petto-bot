// Formats role, channel, invite, and guild changes for the audit-log engine.
const { PermissionsBitField } = require('discord.js');
const { sendLog, getAvatar, fetchMod, prettyPermission, AuditLogEvent } = require('./engine');

/** The permissions in `a` that are not in `b`, by name. (`BitField#remove` changes the bitfield it is called on, so it is not used.) */
const only = (a, b) => new PermissionsBitField(a.bitfield & ~b.bitfield).toArray().map(prettyPermission);

const CHANNEL_TYPES = {
  0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement',
  10: 'Announcement Thread', 11: 'Public Thread', 12: 'Private Thread',
  13: 'Stage', 15: 'Forum', 16: 'Media',
};

async function handleRoleCreate(role, client) {
  const mod = await fetchMod(role.guild, AuditLogEvent.RoleCreate, role.id);
  const fields = [
    { name: 'Name', value: role.name, inline: true },
    { name: 'Color', value: `\`#${role.color.toString(16).padStart(6, '0')}\``, inline: true },
  ];
  if (mod) fields.push({ name: 'By', value: mod, inline: true });

  await sendLog(client, role.guild.id, 'roles', {
    author: { name: 'Role Created' },
    description: `<@&${role.id}> was created`,
    fields,
    footer: { text: `Role ID: ${role.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleRoleDelete(role, client) {
  const mod = await fetchMod(role.guild, AuditLogEvent.RoleDelete, role.id);
  const fields = mod ? [{ name: 'By', value: mod, inline: true }] : [];

  await sendLog(client, role.guild.id, 'roles', {
    author: { name: 'Role Deleted' },
    description: `\`${role.name}\` was deleted`,
    fields,
    footer: { text: `Role ID: ${role.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleRoleUpdate(oldRole, newRole, client) {
  const fields = [];
  if (oldRole.name !== newRole.name) fields.push({ name: 'Name', value: `\`${oldRole.name}\` -> \`${newRole.name}\``, inline: false });
  if (oldRole.color !== newRole.color)
    fields.push({ name: 'Color', value: `\`#${oldRole.color.toString(16).padStart(6, '0')}\` -> \`#${newRole.color.toString(16).padStart(6, '0')}\``, inline: false });
  if (oldRole.hoist !== newRole.hoist) fields.push({ name: 'Hoist', value: `\`${oldRole.hoist}\` -> \`${newRole.hoist}\``, inline: true });
  if (oldRole.mentionable !== newRole.mentionable) fields.push({ name: 'Mentionable', value: `\`${oldRole.mentionable}\` -> \`${newRole.mentionable}\``, inline: true });
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
    const granted = only(newRole.permissions, oldRole.permissions);
    const revoked = only(oldRole.permissions, newRole.permissions);
    if (granted.length) fields.push({ name: 'Permissions granted', value: granted.map((p) => `\`${p}\``).join(', '), inline: false });
    if (revoked.length) fields.push({ name: 'Permissions removed', value: revoked.map((p) => `\`${p}\``).join(', '), inline: false });
  }
  if (oldRole.icon !== newRole.icon) fields.push({ name: 'Icon', value: newRole.icon ? 'The role icon was changed' : 'The role icon was removed', inline: false });
  if ((oldRole.unicodeEmoji ?? null) !== (newRole.unicodeEmoji ?? null)) fields.push({ name: 'Emoji', value: `${oldRole.unicodeEmoji || '*None*'} -> ${newRole.unicodeEmoji || '*None*'}`, inline: true });
  if (!fields.length) return;

  const mod = await fetchMod(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  if (mod) fields.push({ name: 'By', value: mod, inline: true });

  await sendLog(client, newRole.guild.id, 'roles', {
    author: { name: 'Role Updated' },
    description: `<@&${newRole.id}> was updated`,
    fields,
    footer: { text: `Role ID: ${newRole.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleChannelCreate(channel, client) {
  if (!channel.guild) return;
  const mod = await fetchMod(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  const fields = [
    { name: 'Type', value: CHANNEL_TYPES[channel.type] || 'Unknown', inline: true },
    { name: 'Category', value: channel.parent?.name || 'None', inline: true },
  ];
  if (mod) fields.push({ name: 'By', value: mod, inline: true });

  await sendLog(
    client,
    channel.guild.id,
    'channels',
    {
      author: { name: 'Channel Created' },
      description: `<#${channel.id}> (\`${channel.name}\`) was created`,
      fields,
      footer: { text: `Channel ID: ${channel.id}` },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [channel.id] },
  );
}

async function handleChannelDelete(channel, client) {
  if (!channel.guild) return;
  const mod = await fetchMod(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  const fields = [
    { name: 'Type', value: CHANNEL_TYPES[channel.type] || 'Unknown', inline: true },
    { name: 'Category', value: channel.parent?.name || 'None', inline: true },
  ];
  if (mod) fields.push({ name: 'By', value: mod, inline: true });

  await sendLog(client, channel.guild.id, 'channels', {
    author: { name: 'Channel Deleted' },
    description: `\`${channel.name}\` was deleted`,
    fields,
    footer: { text: `Channel ID: ${channel.id}` },
    timestamp: new Date().toISOString(),
  });
}

// The @everyone role is shown as plain text: Discord draws a mention of it as `@@everyone`.
const who = (overwrite) => (overwrite.id === overwrite.channel?.guild?.id ? '`@everyone`' : overwrite.type === 0 ? `<@&${overwrite.id}>` : `<@${overwrite.id}>`);

/** The permission overwrites of a channel that were added, removed or changed, one line each. */
function overwriteChanges(oldChannel, newChannel) {
  const before = oldChannel.permissionOverwrites?.cache;
  const after = newChannel.permissionOverwrites?.cache;
  if (!before || !after) return [];
  const lines = [];
  for (const overwrite of after.values()) {
    const previous = before.get(overwrite.id);
    if (!previous) lines.push(`Added for ${who(overwrite)}`);
    else if (previous.allow.bitfield !== overwrite.allow.bitfield || previous.deny.bitfield !== overwrite.deny.bitfield) {
      const allowed = only(overwrite.allow, previous.allow);
      const denied = only(overwrite.deny, previous.deny);
      const reset = only(previous.allow, overwrite.allow).concat(only(previous.deny, overwrite.deny)).filter((name) => !allowed.includes(name) && !denied.includes(name));
      const parts = [];
      if (allowed.length) parts.push(`allowed ${allowed.join(', ')}`);
      if (denied.length) parts.push(`denied ${denied.join(', ')}`);
      if (reset.length) parts.push(`reset ${reset.join(', ')}`);
      lines.push(`${who(overwrite)}: ${parts.join('; ') || 'changed'}`);
    }
  }
  for (const overwrite of before.values()) if (!after.has(overwrite.id)) lines.push(`Removed for ${who(overwrite)}`);
  return lines;
}

async function handleChannelUpdate(oldChannel, newChannel, client) {
  if (!oldChannel.guild) return;
  const fields = [];
  if (oldChannel.name !== newChannel.name) fields.push({ name: 'Name', value: `\`${oldChannel.name}\` -> \`${newChannel.name}\``, inline: false });
  if (oldChannel.topic !== newChannel.topic) fields.push({ name: 'Topic', value: `${oldChannel.topic || '*None*'} -> ${newChannel.topic || '*None*'}`, inline: false });
  if (oldChannel.parentId !== newChannel.parentId)
    fields.push({ name: 'Category', value: `${oldChannel.parent?.name || 'None'} -> ${newChannel.parent?.name || 'None'}`, inline: false });
  if (Boolean(oldChannel.nsfw) !== Boolean(newChannel.nsfw)) fields.push({ name: 'Age-restricted', value: `\`${Boolean(oldChannel.nsfw)}\` -> \`${Boolean(newChannel.nsfw)}\``, inline: true });
  if ((oldChannel.rateLimitPerUser ?? 0) !== (newChannel.rateLimitPerUser ?? 0)) fields.push({ name: 'Slowmode', value: `${oldChannel.rateLimitPerUser ?? 0}s -> ${newChannel.rateLimitPerUser ?? 0}s`, inline: true });
  if ((oldChannel.bitrate ?? null) !== (newChannel.bitrate ?? null) && newChannel.bitrate) fields.push({ name: 'Bitrate', value: `${Math.round((oldChannel.bitrate ?? 0) / 1000)} kbps -> ${Math.round(newChannel.bitrate / 1000)} kbps`, inline: true });
  if ((oldChannel.userLimit ?? null) !== (newChannel.userLimit ?? null) && newChannel.userLimit !== undefined) fields.push({ name: 'User limit', value: `${oldChannel.userLimit || 'Unlimited'} -> ${newChannel.userLimit || 'Unlimited'}`, inline: true });
  const overwrites = overwriteChanges(oldChannel, newChannel);
  if (overwrites.length) fields.push({ name: 'Permissions', value: overwrites.join('\n').slice(0, 1000), inline: false });
  if (!fields.length) return;

  // Changing permissions is a different audit log action than changing the channel itself.
  const actions = overwrites.length ? [AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteDelete, AuditLogEvent.ChannelUpdate] : [AuditLogEvent.ChannelUpdate];
  let mod = null;
  for (const action of actions) {
    mod = await fetchMod(newChannel.guild, action, newChannel.id);
    if (mod) break;
  }
  if (mod) fields.push({ name: 'By', value: mod, inline: true });

  await sendLog(
    client,
    newChannel.guild.id,
    'channels',
    {
      author: { name: 'Channel Updated' },
      description: `<#${newChannel.id}> was updated`,
      fields,
      footer: { text: `Channel ID: ${newChannel.id}` },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [newChannel.id] },
  );
}

async function handleInviteCreate(invite, client) {
  if (!invite.guild) return;
  const inviter = invite.inviter;
  const fields = [
    { name: 'Code', value: `discord.gg/${invite.code}`, inline: true },
    { name: 'Channel', value: `<#${invite.channelId}>`, inline: true },
    { name: 'Created by', value: inviter ? `<@${inviter.id}>` : '*Unknown*', inline: true },
  ];
  if (invite.maxAge) {
    fields.push({ name: 'Expires', value: `<t:${Math.floor(Date.now() / 1000) + invite.maxAge}:R>`, inline: true });
  }

  await sendLog(client, invite.guild.id, 'invites', {
    author: { name: 'Invite Created', icon_url: inviter ? getAvatar(inviter) ?? undefined : undefined },
    description: `A new invite was created in <#${invite.channelId}>`,
    fields,
    footer: { text: `Code: ${invite.code}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleInviteDelete(invite, client) {
  if (!invite.guild) return;
  await sendLog(client, invite.guild.id, 'invites', {
    author: { name: 'Invite Deleted' },
    description: `An invite was deleted in <#${invite.channelId}>`,
    fields: [{ name: 'Code', value: `discord.gg/${invite.code}`, inline: true }],
    footer: { text: `Code: ${invite.code}` },
    timestamp: new Date().toISOString(),
  });
}

const LEVEL_NAMES = {
  verification: { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Very high' },
  filter: { 0: 'Off', 1: 'Members without roles', 2: 'All members' },
  notifications: { 0: 'All messages', 1: 'Only mentions' },
};

async function handleGuildUpdate(oldGuild, newGuild, client) {
  const fields = [];
  if (oldGuild.name !== newGuild.name) fields.push({ name: 'Name', value: `\`${oldGuild.name}\` -> \`${newGuild.name}\``, inline: false });
  if (oldGuild.icon !== newGuild.icon) fields.push({ name: 'Icon', value: 'Server icon was changed', inline: false });
  if (oldGuild.banner !== newGuild.banner) fields.push({ name: 'Banner', value: 'Server banner was changed', inline: false });
  if (oldGuild.description !== newGuild.description)
    fields.push({ name: 'Description', value: `${oldGuild.description || '*None*'} -> ${newGuild.description || '*None*'}`, inline: false });
  if ((oldGuild.vanityURLCode ?? null) !== (newGuild.vanityURLCode ?? null)) fields.push({ name: 'Vanity URL', value: `${oldGuild.vanityURLCode ? `discord.gg/${oldGuild.vanityURLCode}` : '*None*'} -> ${newGuild.vanityURLCode ? `discord.gg/${newGuild.vanityURLCode}` : '*None*'}`, inline: false });
  if (Boolean(oldGuild.widgetEnabled) !== Boolean(newGuild.widgetEnabled)) fields.push({ name: 'Widget', value: newGuild.widgetEnabled ? 'Enabled' : 'Disabled', inline: true });
  if (oldGuild.premiumTier !== newGuild.premiumTier) fields.push({ name: 'Boost level', value: `${oldGuild.premiumTier} -> ${newGuild.premiumTier}`, inline: true });
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) fields.push({ name: 'Verification level', value: `${LEVEL_NAMES.verification[oldGuild.verificationLevel] ?? oldGuild.verificationLevel} -> ${LEVEL_NAMES.verification[newGuild.verificationLevel] ?? newGuild.verificationLevel}`, inline: false });
  if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) fields.push({ name: 'Explicit media filter', value: `${LEVEL_NAMES.filter[oldGuild.explicitContentFilter] ?? oldGuild.explicitContentFilter} -> ${LEVEL_NAMES.filter[newGuild.explicitContentFilter] ?? newGuild.explicitContentFilter}`, inline: false });
  if (oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications) fields.push({ name: 'Default notifications', value: `${LEVEL_NAMES.notifications[oldGuild.defaultMessageNotifications] ?? oldGuild.defaultMessageNotifications} -> ${LEVEL_NAMES.notifications[newGuild.defaultMessageNotifications] ?? newGuild.defaultMessageNotifications}`, inline: false });
  if (oldGuild.mfaLevel !== newGuild.mfaLevel) fields.push({ name: '2FA for moderators', value: newGuild.mfaLevel ? 'Required' : 'Not required', inline: true });
  for (const [key, label] of [['systemChannelId', 'System messages channel'], ['rulesChannelId', 'Rules channel'], ['publicUpdatesChannelId', 'Community updates channel'], ['afkChannelId', 'AFK channel']]) {
    if ((oldGuild[key] ?? null) !== (newGuild[key] ?? null)) fields.push({ name: label, value: `${oldGuild[key] ? `<#${oldGuild[key]}>` : '*None*'} -> ${newGuild[key] ? `<#${newGuild[key]}>` : '*None*'}`, inline: false });
  }
  if (oldGuild.afkTimeout !== newGuild.afkTimeout) fields.push({ name: 'AFK timeout', value: `${oldGuild.afkTimeout / 60} min -> ${newGuild.afkTimeout / 60} min`, inline: true });
  if (oldGuild.preferredLocale !== newGuild.preferredLocale) fields.push({ name: 'Language', value: `${oldGuild.preferredLocale} -> ${newGuild.preferredLocale}`, inline: true });
  if (!fields.length) return;

  const mod = await fetchMod(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
  if (mod) fields.push({ name: 'By', value: mod, inline: true });

  const embed = {
    author: { name: 'Server Updated', icon_url: newGuild.iconURL({ extension: 'png', size: 256 }) ?? undefined },
    description: `**${newGuild.name}** was updated`,
    fields,
    footer: { text: `Guild ID: ${newGuild.id}` },
    timestamp: new Date().toISOString(),
  };

  if (oldGuild.icon !== newGuild.icon && newGuild.iconURL()) {
    embed.image = { url: newGuild.iconURL({ extension: 'png', size: 512 }) };
  }

  await sendLog(client, newGuild.id, 'server', embed);
}

const EVENT_STATUS = { 1: 'Scheduled', 2: 'Active', 3: 'Completed', 4: 'Canceled' };

function scheduledEventFields(event) {
  const fields = [];
  if (event.scheduledStartTimestamp) fields.push({ name: 'Starts', value: `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:F>`, inline: true });
  if (event.scheduledEndTimestamp) fields.push({ name: 'Ends', value: `<t:${Math.floor(event.scheduledEndTimestamp / 1000)}:F>`, inline: true });
  const where = event.channelId ? `<#${event.channelId}>` : event.entityMetadata?.location;
  if (where) fields.push({ name: 'Where', value: where, inline: true });
  if (event.description) fields.push({ name: 'Description', value: event.description.slice(0, 300), inline: false });
  return fields;
}

async function handleScheduledEventCreate(event, client) {
  if (!event.guild) return;
  const fields = scheduledEventFields(event);
  const by = event.creatorId ? `<@${event.creatorId}>` : await fetchMod(event.guild, AuditLogEvent.GuildScheduledEventCreate, event.id);
  if (by) fields.push({ name: 'By', value: by, inline: true });
  await sendLog(client, event.guild.id, 'server', {
    author: { name: 'Event Created' },
    description: `The event \`${event.name}\` was scheduled`,
    fields,
    footer: { text: `Event ID: ${event.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleScheduledEventDelete(event, client) {
  if (!event.guild) return;
  const mod = await fetchMod(event.guild, AuditLogEvent.GuildScheduledEventDelete, event.id);
  const fields = scheduledEventFields(event);
  if (mod) fields.push({ name: 'By', value: mod, inline: true });
  await sendLog(client, event.guild.id, 'server', {
    author: { name: 'Event Deleted' },
    description: `The event \`${event.name}\` was deleted`,
    fields,
    footer: { text: `Event ID: ${event.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleScheduledEventUpdate(oldEvent, newEvent, client) {
  if (!newEvent.guild || !oldEvent) return;
  const fields = [];
  if (oldEvent.name !== newEvent.name) fields.push({ name: 'Name', value: `\`${oldEvent.name}\` -> \`${newEvent.name}\``, inline: false });
  if (oldEvent.status !== newEvent.status) fields.push({ name: 'Status', value: `${EVENT_STATUS[oldEvent.status] ?? '?'} -> ${EVENT_STATUS[newEvent.status] ?? '?'}`, inline: true });
  if (oldEvent.scheduledStartTimestamp !== newEvent.scheduledStartTimestamp && newEvent.scheduledStartTimestamp) fields.push({ name: 'Starts', value: `<t:${Math.floor(newEvent.scheduledStartTimestamp / 1000)}:F>`, inline: true });
  if ((oldEvent.description ?? '') !== (newEvent.description ?? '')) fields.push({ name: 'Description', value: 'The description was changed', inline: true });
  if ((oldEvent.channelId ?? oldEvent.entityMetadata?.location) !== (newEvent.channelId ?? newEvent.entityMetadata?.location)) fields.push({ name: 'Where', value: newEvent.channelId ? `<#${newEvent.channelId}>` : newEvent.entityMetadata?.location ?? 'None', inline: true });
  if (!fields.length) return;
  const mod = await fetchMod(newEvent.guild, AuditLogEvent.GuildScheduledEventUpdate, newEvent.id);
  if (mod) fields.push({ name: 'By', value: mod, inline: true });
  await sendLog(client, newEvent.guild.id, 'server', {
    author: { name: 'Event Updated' },
    description: `The event \`${newEvent.name}\` was updated`,
    fields,
    footer: { text: `Event ID: ${newEvent.id}` },
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
