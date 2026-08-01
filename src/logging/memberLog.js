const { sendLog, getAvatar, fetchMod, AuditLogEvent } = require('./engine');
const { resolveJoinInvite } = require('../utils/inviteResolve');

// Discord's gateway sometimes fires USER_UPDATE twice in a row for the same real change (the
// CDN avatar hash and the user's `avatar` field don't always land in the same event) — this
// dedupes against that so the "Avatar Changed"/"Username Changed" log doesn't get double-sent.
const recentUserUpdates = new Map(); // userId -> `${avatarURL}:${username}`
const RECENT_UPDATE_TTL_MS = 10_000;

async function handleMemberJoin(member, client) {
  const fields = [
    { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
    { name: 'Members', value: String(member.guild.memberCount), inline: true },
  ];

  const usedInvite = await resolveJoinInvite(member).catch(() => null);
  if (usedInvite) {
    fields.push({ name: 'Invited by', value: usedInvite.inviter ? `<@${usedInvite.inviter.id}> (**${usedInvite.inviter.username}**)` : 'Unknown', inline: true });
    fields.push({ name: 'Invite', value: `\`${usedInvite.code}\` · ${usedInvite.uses ?? 0} uses`, inline: true });
  }

  await sendLog(
    client,
    member.guild.id,
    'members',
    {
      author: { name: 'Member Joined', icon_url: getAvatar(member.user) ?? undefined },
      description: `<@${member.id}> joined the server`,
      fields,
      footer: { text: `User ID: ${member.id}` },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [member.id] },
  );
}

async function handleMemberLeave(member, client) {
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .map((r) => `<@&${r.id}>`)
    .join(' ') || 'None';

  await sendLog(
    client,
    member.guild.id,
    'members',
    {
      author: { name: 'Member Left', icon_url: getAvatar(member.user) ?? undefined },
      description: `<@${member.id}> left the server`,
      fields: [
        { name: 'Joined', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
        { name: 'Roles', value: roles.slice(0, 1024), inline: false },
      ],
      footer: { text: `User ID: ${member.id}` },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [member.id] },
  );
}

async function handleMemberUpdate(oldMember, newMember, client) {
  // Role changes -> `roles` event
  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;
  const rolesChanged = oldRoles.size !== newRoles.size || oldRoles.some((r) => !newRoles.has(r.id));

  if (rolesChanged) {
    const added = newRoles.filter((r) => !oldRoles.has(r.id));
    const removed = oldRoles.filter((r) => !newRoles.has(r.id));

    if (added.size || removed.size) {
      const mod = await fetchMod(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
      const fields = [];
      if (added.size) fields.push({ name: 'Added', value: added.map((r) => `<@&${r.id}>`).join(' '), inline: true });
      if (removed.size) fields.push({ name: 'Removed', value: removed.map((r) => `<@&${r.id}>`).join(' '), inline: true });
      if (mod) fields.push({ name: 'By', value: mod, inline: true });

      await sendLog(
        client,
        newMember.guild.id,
        'roles',
        {
          author: { name: 'Member Roles Updated', icon_url: getAvatar(newMember.user) ?? undefined },
          description: `<@${newMember.id}> (\`${newMember.user.username}\`) roles were updated`,
          fields,
          footer: { text: `User ID: ${newMember.id}` },
          timestamp: new Date().toISOString(),
        },
        { ignoreIds: [newMember.id] },
      );
    }
  }

  // Nickname -> `members` event
  if (oldMember.nickname !== newMember.nickname) {
    const mod = await fetchMod(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
    const fields = [
      { name: 'Before', value: oldMember.nickname || '*None*', inline: true },
      { name: 'After', value: newMember.nickname || '*None*', inline: true },
    ];
    if (mod) fields.push({ name: 'By', value: mod, inline: true });

    await sendLog(
      client,
      newMember.guild.id,
      'members',
      {
        author: { name: 'Nickname Changed', icon_url: getAvatar(newMember.user) ?? undefined },
        description: `<@${newMember.id}> (\`${newMember.user.username}\`) changed their nickname`,
        fields,
        footer: { text: `User ID: ${newMember.id}` },
        timestamp: new Date().toISOString(),
      },
      { ignoreIds: [newMember.id] },
    );
  }
}

async function handleUserUpdate(oldUser, newUser, client) {
  const avatarChanged = oldUser.displayAvatarURL() !== newUser.displayAvatarURL();
  const usernameChanged = oldUser.username !== newUser.username;
  if (!avatarChanged && !usernameChanged) return;

  const fingerprint = `${newUser.displayAvatarURL()}:${newUser.username}`;
  if (recentUserUpdates.get(newUser.id) === fingerprint) return;
  recentUserUpdates.set(newUser.id, fingerprint);
  setTimeout(() => {
    if (recentUserUpdates.get(newUser.id) === fingerprint) recentUserUpdates.delete(newUser.id);
  }, RECENT_UPDATE_TTL_MS);

  for (const guild of client.guilds.cache.values()) {
    const inGuild = guild.members.cache.has(newUser.id) || (await guild.members.fetch(newUser.id).then(() => true).catch(() => false));
    if (!inGuild) continue;

    if (usernameChanged) {
      await sendLog(
        client,
        guild.id,
        'members',
        {
          author: { name: 'Username Changed', icon_url: getAvatar(newUser) ?? undefined },
          description: `<@${newUser.id}> changed their username`,
          fields: [
            { name: 'Before', value: `\`${oldUser.username}\``, inline: true },
            { name: 'After', value: `\`${newUser.username}\``, inline: true },
          ],
          footer: { text: `User ID: ${newUser.id}` },
          timestamp: new Date().toISOString(),
        },
        { ignoreIds: [newUser.id] },
      );
    }

    if (avatarChanged) {
      const newAva = newUser.displayAvatarURL({ extension: 'png', size: 512 });
      await sendLog(
        client,
        guild.id,
        'members',
        {
          author: { name: 'Avatar Changed', icon_url: newAva },
          description: `<@${newUser.id}> changed their avatar`,
          image: { url: newAva },
          footer: { text: `User ID: ${newUser.id}` },
          timestamp: new Date().toISOString(),
        },
        { ignoreIds: [newUser.id] },
      );
    }
  }
}

async function handleBanAdd(ban, client) {
  const mod = await fetchMod(ban.guild, AuditLogEvent.MemberBan, ban.user.id);
  const fields = ban.reason ? [{ name: 'Reason', value: ban.reason, inline: false }] : [];
  if (mod) fields.push({ name: 'By', value: mod, inline: true });

  await sendLog(client, ban.guild.id, 'members', {
    author: { name: 'Member Banned', icon_url: getAvatar(ban.user) ?? undefined },
    description: `<@${ban.user.id}> (\`${ban.user.username}\`) was banned`,
    fields,
    footer: { text: `User ID: ${ban.user.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleBanRemove(ban, client) {
  const mod = await fetchMod(ban.guild, AuditLogEvent.MemberUnban, ban.user.id);
  const fields = mod ? [{ name: 'By', value: mod, inline: true }] : [];

  await sendLog(client, ban.guild.id, 'members', {
    author: { name: 'Member Unbanned', icon_url: getAvatar(ban.user) ?? undefined },
    description: `<@${ban.user.id}> (\`${ban.user.username}\`) was unbanned`,
    fields,
    footer: { text: `User ID: ${ban.user.id}` },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { handleMemberJoin, handleMemberLeave, handleMemberUpdate, handleUserUpdate, handleBanAdd, handleBanRemove };
