// Formats role, channel, invite, and guild changes for the audit-log engine.
const { sendLog, getAvatar, fetchMod, AuditLogEvent } = require('./engine');

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
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) fields.push({ name: 'Permissions', value: 'Permissions were modified', inline: false });
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

async function handleChannelUpdate(oldChannel, newChannel, client) {
  if (!oldChannel.guild) return;
  const fields = [];
  if (oldChannel.name !== newChannel.name) fields.push({ name: 'Name', value: `\`${oldChannel.name}\` -> \`${newChannel.name}\``, inline: false });
  if (oldChannel.topic !== newChannel.topic) fields.push({ name: 'Topic', value: `${oldChannel.topic || '*None*'} -> ${newChannel.topic || '*None*'}`, inline: false });
  if (oldChannel.parentId !== newChannel.parentId)
    fields.push({ name: 'Category', value: `${oldChannel.parent?.name || 'None'} -> ${newChannel.parent?.name || 'None'}`, inline: false });
  if (!fields.length) return;

  const mod = await fetchMod(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
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

async function handleGuildUpdate(oldGuild, newGuild, client) {
  const fields = [];
  if (oldGuild.name !== newGuild.name) fields.push({ name: 'Name', value: `\`${oldGuild.name}\` -> \`${newGuild.name}\``, inline: false });
  if (oldGuild.icon !== newGuild.icon) fields.push({ name: 'Icon', value: 'Server icon was changed', inline: false });
  if (oldGuild.banner !== newGuild.banner) fields.push({ name: 'Banner', value: 'Server banner was changed', inline: false });
  if (oldGuild.description !== newGuild.description)
    fields.push({ name: 'Description', value: `${oldGuild.description || '*None*'} -> ${newGuild.description || '*None*'}`, inline: false });
  if (!fields.length) return;

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

module.exports = {
  handleRoleCreate, handleRoleDelete, handleRoleUpdate,
  handleChannelCreate, handleChannelDelete, handleChannelUpdate,
  handleInviteCreate, handleInviteDelete,
  handleGuildUpdate,
};
