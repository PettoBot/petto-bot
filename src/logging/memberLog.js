const { sendLog, getAvatar, fetchMod, fetchEntry, AuditLogEvent } = require('./engine');
const { resolveJoinInvite } = require('../utils/inviteResolve');
const { handleBotAdded, handleBotRemoved } = require('./extraLog');
const { t, tn, guildLanguage } = require('../i18n');

// Discord's gateway sometimes fires USER_UPDATE twice in a row for the same real change (the
// CDN avatar hash and the user's `avatar` field don't always land in the same event) — this
// dedupes against that so the "Avatar Changed"/"Username Changed" log doesn't get double-sent.
const recentUserUpdates = new Map(); // userId -> `${avatarURL}:${username}`
const RECENT_UPDATE_TTL_MS = 10_000;

async function handleMemberJoin(member, client) {
  if (member.user.bot) await handleBotAdded(member, client).catch(() => {});
  const lang = await guildLanguage(member.guild.id);
  const fields = [
    { name: t(lang, 'logs.field.accountCreated'), value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
    { name: t(lang, 'logs.member.members'), value: String(member.guild.memberCount), inline: true },
  ];

  const usedInvite = await resolveJoinInvite(member).catch(() => null);
  if (usedInvite) {
    fields.push({ name: t(lang, 'logs.member.invitedBy'), value: usedInvite.inviter ? `<@${usedInvite.inviter.id}> (**${usedInvite.inviter.username}**)` : t(lang, 'logs.unknown'), inline: true });
    // The number is written as it is (no thousands separator), like it always was.
    const uses = usedInvite.uses ?? 0;
    fields.push({ name: t(lang, 'logs.member.invite'), value: tn(lang, 'logs.member.inviteUses', uses, { count: uses, code: usedInvite.code }), inline: true });
  }

  await sendLog(
    client,
    member.guild.id,
    'members',
    {
      author: { name: t(lang, 'logs.member.joined.title'), icon_url: getAvatar(member.user) ?? undefined },
      description: t(lang, 'logs.member.joined.description', { member: `<@${member.id}>` }),
      fields,
      footer: { text: t(lang, 'logs.footer.user', { id: member.id }) },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [member.id] },
  );
}

async function handleMemberLeave(member, client) {
  if (member.user?.bot) await handleBotRemoved(member, client).catch(() => {});
  const lang = await guildLanguage(member.guild.id);
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .map((r) => `<@&${r.id}>`)
    .join(' ') || t(lang, 'logs.none');

  // A kick leaves the server like any other leave, so the audit log tells them apart.
  const kick = await fetchEntry(member.guild, AuditLogEvent.MemberKick, member.id);
  const fields = [
    { name: t(lang, 'logs.member.joinedField'), value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : t(lang, 'logs.unknown'), inline: true },
    { name: t(lang, 'logs.field.roles'), value: roles.slice(0, 1024), inline: false },
  ];
  if (kick?.executor) fields.push({ name: t(lang, 'logs.field.by'), value: `<@${kick.executor.id}>`, inline: true });
  if (kick?.reason) fields.push({ name: t(lang, 'logs.field.reason'), value: kick.reason, inline: false });

  await sendLog(
    client,
    member.guild.id,
    'members',
    {
      author: { name: t(lang, kick ? 'logs.member.kicked.title' : 'logs.member.left.title'), icon_url: getAvatar(member.user) ?? undefined },
      description: t(lang, kick ? 'logs.member.kicked.description' : 'logs.member.left.description', { member: `<@${member.id}>` }),
      fields,
      footer: { text: t(lang, 'logs.footer.user', { id: member.id }) },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [member.id] },
  );
}

async function handleMemberUpdate(oldMember, newMember, client) {
  const lang = await guildLanguage(newMember.guild.id);
  // Who the log is about: the mention and the username.
  const vars = { member: `<@${newMember.id}>`, username: newMember.user.username };

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
      if (added.size) fields.push({ name: t(lang, 'logs.member.rolesAdded'), value: added.map((r) => `<@&${r.id}>`).join(' '), inline: true });
      if (removed.size) fields.push({ name: t(lang, 'logs.member.rolesRemoved'), value: removed.map((r) => `<@&${r.id}>`).join(' '), inline: true });
      if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });

      await sendLog(
        client,
        newMember.guild.id,
        'roles',
        {
          author: { name: t(lang, 'logs.member.roles.title'), icon_url: getAvatar(newMember.user) ?? undefined },
          description: t(lang, 'logs.member.roles.description', vars),
          fields,
          footer: { text: t(lang, 'logs.footer.user', { id: newMember.id }) },
          timestamp: new Date().toISOString(),
        },
        { ignoreIds: [newMember.id] },
      );
    }
  }

  // Timeout, boosting and the server avatar -> `members` event
  const memberEmbed = (what, fields) => ({
    author: { name: t(lang, `logs.member.${what}.title`), icon_url: getAvatar(newMember.user) ?? undefined },
    description: t(lang, `logs.member.${what}.description`, vars),
    fields,
    footer: { text: t(lang, 'logs.footer.user', { id: newMember.id }) },
    timestamp: new Date().toISOString(),
  });
  const oldUntil = oldMember.communicationDisabledUntilTimestamp ?? null;
  const newUntil = newMember.communicationDisabledUntilTimestamp ?? null;
  const activeNow = (until) => until !== null && until > Date.now();
  if (activeNow(newUntil) && newUntil !== oldUntil) {
    const entry = await fetchEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
    const fields = [{ name: t(lang, 'logs.member.until'), value: `<t:${Math.floor(newUntil / 1000)}:F> (<t:${Math.floor(newUntil / 1000)}:R>)`, inline: false }];
    if (entry?.executor) fields.push({ name: t(lang, 'logs.field.by'), value: `<@${entry.executor.id}>`, inline: true });
    if (entry?.reason) fields.push({ name: t(lang, 'logs.field.reason'), value: entry.reason, inline: false });
    await sendLog(client, newMember.guild.id, 'members', memberEmbed('timedOut', fields), { ignoreIds: [newMember.id] });
  } else if (activeNow(oldUntil) && !activeNow(newUntil)) {
    const mod = await fetchMod(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
    await sendLog(client, newMember.guild.id, 'members', memberEmbed('timeoutRemoved', mod ? [{ name: t(lang, 'logs.field.by'), value: mod, inline: true }] : []), { ignoreIds: [newMember.id] });
  }
  if (!oldMember.premiumSinceTimestamp && newMember.premiumSinceTimestamp) {
    await sendLog(client, newMember.guild.id, 'members', memberEmbed('boostStarted', []), { ignoreIds: [newMember.id] });
  } else if (oldMember.premiumSinceTimestamp && !newMember.premiumSinceTimestamp) {
    await sendLog(client, newMember.guild.id, 'members', memberEmbed('boostStopped', []), { ignoreIds: [newMember.id] });
  }
  if ((oldMember.avatar ?? null) !== (newMember.avatar ?? null)) {
    await sendLog(client, newMember.guild.id, 'members', memberEmbed(newMember.avatar ? 'serverAvatarChanged' : 'serverAvatarRemoved', []), { ignoreIds: [newMember.id] });
  }

  // Nickname -> `members` event
  if (oldMember.nickname !== newMember.nickname) {
    const mod = await fetchMod(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
    const none = t(lang, 'logs.noneItalic');
    const fields = [
      { name: t(lang, 'logs.field.before'), value: oldMember.nickname || none, inline: true },
      { name: t(lang, 'logs.field.after'), value: newMember.nickname || none, inline: true },
    ];
    if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });

    await sendLog(
      client,
      newMember.guild.id,
      'members',
      {
        author: { name: t(lang, 'logs.member.nickname.title'), icon_url: getAvatar(newMember.user) ?? undefined },
        description: t(lang, 'logs.member.nickname.description', vars),
        fields,
        footer: { text: t(lang, 'logs.footer.user', { id: newMember.id }) },
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
    // A user is not in one server: each server reads it in its own language.
    const lang = await guildLanguage(guild.id);

    if (usernameChanged) {
      await sendLog(
        client,
        guild.id,
        'members',
        {
          author: { name: t(lang, 'logs.member.username.title'), icon_url: getAvatar(newUser) ?? undefined },
          description: t(lang, 'logs.member.username.description', { member: `<@${newUser.id}>` }),
          fields: [
            { name: t(lang, 'logs.field.before'), value: `\`${oldUser.username}\``, inline: true },
            { name: t(lang, 'logs.field.after'), value: `\`${newUser.username}\``, inline: true },
          ],
          footer: { text: t(lang, 'logs.footer.user', { id: newUser.id }) },
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
          author: { name: t(lang, 'logs.member.avatar.title'), icon_url: newAva },
          description: t(lang, 'logs.member.avatar.description', { member: `<@${newUser.id}>` }),
          image: { url: newAva },
          footer: { text: t(lang, 'logs.footer.user', { id: newUser.id }) },
          timestamp: new Date().toISOString(),
        },
        { ignoreIds: [newUser.id] },
      );
    }
  }
}

async function handleBanAdd(ban, client) {
  const lang = await guildLanguage(ban.guild.id);
  const mod = await fetchMod(ban.guild, AuditLogEvent.MemberBan, ban.user.id);
  const fields = ban.reason ? [{ name: t(lang, 'logs.field.reason'), value: ban.reason, inline: false }] : [];
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });

  await sendLog(client, ban.guild.id, 'members', {
    author: { name: t(lang, 'logs.member.banned.title'), icon_url: getAvatar(ban.user) ?? undefined },
    description: t(lang, 'logs.member.banned.description', { member: `<@${ban.user.id}>`, username: ban.user.username }),
    fields,
    footer: { text: t(lang, 'logs.footer.user', { id: ban.user.id }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleBanRemove(ban, client) {
  const lang = await guildLanguage(ban.guild.id);
  const mod = await fetchMod(ban.guild, AuditLogEvent.MemberUnban, ban.user.id);
  const fields = mod ? [{ name: t(lang, 'logs.field.by'), value: mod, inline: true }] : [];

  await sendLog(client, ban.guild.id, 'members', {
    author: { name: t(lang, 'logs.member.unbanned.title'), icon_url: getAvatar(ban.user) ?? undefined },
    description: t(lang, 'logs.member.unbanned.description', { member: `<@${ban.user.id}>`, username: ban.user.username }),
    fields,
    footer: { text: t(lang, 'logs.footer.user', { id: ban.user.id }) },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { handleMemberJoin, handleMemberLeave, handleMemberUpdate, handleUserUpdate, handleBanAdd, handleBanRemove };
