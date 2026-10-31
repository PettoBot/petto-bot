const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { createCase, getActiveSanction, deactivateCase } = require('../../db/modActions');
const { canModerate } = require('../../utils/permissions');
const { textCard } = require('../../utils/caseCard');
const { logSanction } = require('../../utils/caseLog');
const { sanctionDM, sanctionReply } = require('../../utils/sanctionTemplates');
const { ensureMuteRole } = require('../../utils/muteRole');
const { resolveUsers } = require('../../utils/userResolve');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { confirmBulkAction, requireAdministrator, failureDetail, bulkTargetBlocked, protectedLine } = require('../../utils/moderationCommand');
const { reasonText } = require('../../utils/caseFormat');
const { t, tn, languageOf } = require('../../i18n');
const { caseNumberList, mentionList, listWithMore } = require('../../utils/listCap');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord's native timeout hard limit

module.exports = {
  aliases: ['m'],
  prefixDefaultSubcommand: 'user',
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Stop a member from talking, with an optional length and reason.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Mute a single member indefinitely, until manually unmuted.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to mute').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the mute').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('users')
        .setDescription('Mute multiple members indefinitely with the same reason.')
        .addStringOption((opt) => opt.setName('users').setDescription('Mentions, IDs, or exact usernames; separate with spaces or commas').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the mutes').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('temp')
        .setDescription("Mute a member for a set amount of time (Discord's native timeout, max 28 days).")
        .addUserOption((opt) => opt.setName('user').setDescription('The user to mute').setRequired(true))
        .addStringOption((opt) => opt.setName('duration').setDescription('e.g. 10m, 2h, 7d (max 28d)').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the mute').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a mute (timeout or mute role) from a member.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to unmute').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the unmute').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-users')
        .setDescription('Unmute multiple members at once.')
        .addStringOption((opt) => opt.setName('users').setDescription('Mentions, IDs, or exact usernames; separate with spaces or commas').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the unmutes').setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List the members who are timed out or have the mute role.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'user') return muteUser(interaction);
    if (sub === 'users') return muteUsers(interaction);
    if (sub === 'temp') return tempMute(interaction);
    if (sub === 'remove') return unmuteUser(interaction);
    if (sub === 'list') return listMuted(interaction);
    return unmuteUsers(interaction);
  },
};

async function muteUser(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.ModerateMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: t(lang, 'moderation.mute.needsManageRoles'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const guildConfig = await ensureGuild(interaction.guild.id);

  let muteRole;
  try {
    muteRole = await ensureMuteRole(interaction.guild, guildConfig);
  } catch (err) {
    logger.error('Failed to set up mute role:', err);
    await interaction.editReply({
      components: [textCard(t(lang, 'moderation.mute.roleSetupFailed'), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  try {
    await targetMember.roles.add(muteRole, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to mute member:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.mute.failedRole', { detail: failureDetail(err, lang) }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'mute', reason });

  await sanctionReply(interaction, { modCase, type: 'mute', target: targetUser, moderator: interaction.user, reason });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });

  await targetMember
    .send(await sanctionDM({ type: 'mute', guild: interaction.guild, client: interaction.client, reason, member: targetMember, moderator: interaction.user, caseNumber: modCase.case_number }))
    .catch(() => logger.warn(`Could not DM mute notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function muteUsers(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const usersInput = interaction.options.getString('users', true);
  const reason = interaction.options.getString('reason');

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: t(lang, 'moderation.mute.needsManageRoles'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  if (!(await confirmBulkAction(interaction, 'mute', usersInput))) return;

  const guildConfig = await ensureGuild(interaction.guild.id);

  let muteRole;
  try {
    muteRole = await ensureMuteRole(interaction.guild, guildConfig);
  } catch (err) {
    logger.error('Failed to set up mute role:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.mute.roleSetupFailedShort'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const { users, failed: notFound } = await resolveUsers(interaction.client, usersInput, interaction.guild);

  const succeeded = [];
  const failed = [];
  const skipped = [];
  const blocked = [];
  const caseNumbers = [];

  for (const user of users) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      skipped.push(user);
      continue;
    }
    if (bulkTargetBlocked(interaction, member, PermissionFlagsBits.ModerateMembers, { hierarchy: 'none' })) {
      blocked.push(user);
      continue;
    }

    try {
      await member.roles.add(muteRole, reason ?? undefined);
      const modCase = await createCase({ guildId: interaction.guild.id, userId: user.id, moderatorId: interaction.user.id, type: 'mute', reason });
      caseNumbers.push(modCase.case_number);
      succeeded.push(user);
      await logSanction(interaction.client, interaction.guild, { modCase, target: user, moderator: interaction.user, reason });
      await member
        .send(await sanctionDM({ type: 'mute', guild: interaction.guild, client: interaction.client, reason, member: member, moderator: interaction.user, caseNumber: modCase.case_number }))
        .catch(() => logger.warn(`Could not DM mute notice to ${user.id} in guild ${interaction.guild.id}.`));
    } catch (err) {
      logger.warn(`mute users: failed to mute ${user.id}:`, err.message);
      failed.push(user);
    }
  }

  const lines = [tn(lang, 'moderation.mute.bulkDone', succeeded.length, { emoji: EMOJI.ALERT, count: succeeded.length, cases: caseNumbers.length ? t(lang, 'moderation.common.cases', { list: caseNumberList(lang, caseNumbers) }) : '' })];
  if (succeeded.length) lines.push(mentionList(lang, succeeded));
  if (failed.length) lines.push(t(lang, 'moderation.common.failedList', { emoji: EMOJI.DENY, list: mentionList(lang, failed) }));
  if (skipped.length) lines.push(t(lang, 'moderation.common.notInServer', { list: mentionList(lang, skipped) }));
  if (blocked.length) lines.push(protectedLine(blocked, lang));
  if (notFound.length) lines.push(t(lang, 'moderation.common.notFound', { list: listWithMore(lang, notFound, { format: (id) => `\`${id}\`` }) }));
  lines.push(t(lang, 'moderation.common.reason', { reason: reasonText(reason, lang) }));

  const card = textCard(lines.join('\n'), 0xfed53c, { keep: true });
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
}

async function tempMute(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');
  const durationMs = parseDuration(interaction.options.getString('duration', true));

  if (!durationMs) {
    await interaction.reply({ content: t(lang, 'moderation.duration.invalidMute'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (durationMs > MAX_TIMEOUT_MS) {
    await interaction.reply({ content: t(lang, 'moderation.mute.timeoutCap'), flags: MessageFlags.Ephemeral });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.ModerateMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.timeout(durationMs, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to timeout member:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.mute.failed', { detail: failureDetail(err, lang) }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  await ensureGuild(interaction.guild.id);
  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'tempmute', reason, expiresAt });

  const duration = formatDuration(durationMs, lang);
  await sanctionReply(interaction, { modCase, type: 'tempmute', target: targetUser, moderator: interaction.user, reason, duration });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason, duration });

  await targetMember
    .send(await sanctionDM({ type: 'tempmute', guild: interaction.guild, client: interaction.client, reason, duration, member: targetMember, moderator: interaction.user, caseNumber: modCase.case_number }))
    .catch(() => logger.warn(`Could not DM tempmute notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function unmuteUser(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.ModerateMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const guildConfig = await ensureGuild(interaction.guild.id);
  let didSomething = false;

  if (targetMember.isCommunicationDisabled?.()) {
    await targetMember.timeout(null, reason ?? undefined).catch((err) => logger.warn('Failed to clear timeout:', err.message));
    didSomething = true;
  }

  if (guildConfig.mute_role_id && targetMember.roles.cache.has(guildConfig.mute_role_id)) {
    await targetMember.roles.remove(guildConfig.mute_role_id, reason ?? undefined).catch((err) => logger.warn('Failed to remove mute role:', err.message));
    didSomething = true;
  }

  const activeSanction = await getActiveSanction(interaction.guild.id, targetUser.id, ['mute', 'tempmute']);
  if (activeSanction) {
    await deactivateCase(interaction.guild.id, activeSanction.case_number);
    didSomething = true;
  }

  if (!didSomething) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.unmute.notMuted'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'unmute', reason });

  await sanctionReply(interaction, { modCase, type: 'unmute', target: targetUser, moderator: interaction.user, reason });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });

  await targetMember
    .send(await sanctionDM({ type: 'unmute', guild: interaction.guild, client: interaction.client, reason, member: targetMember, moderator: interaction.user, caseNumber: modCase.case_number }))
    .catch(() => logger.warn(`Could not DM unmute notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
}

async function unmuteUsers(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const usersInput = interaction.options.getString('users', true);
  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  if (!(await confirmBulkAction(interaction, 'unmute', usersInput))) return;

  const { users, failed: notFound } = await resolveUsers(interaction.client, usersInput, interaction.guild);
  const guildConfig = await ensureGuild(interaction.guild.id);

  const succeeded = [];
  const skipped = [];
  const blocked = [];
  const caseNumbers = [];

  for (const user of users) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      skipped.push(user);
      continue;
    }
    if (bulkTargetBlocked(interaction, member, PermissionFlagsBits.ModerateMembers, { hierarchy: 'none' })) {
      blocked.push(user);
      continue;
    }

    let didSomething = false;

    if (member.isCommunicationDisabled?.()) {
      await member.timeout(null, reason ?? undefined).catch((err) => logger.warn('Failed to clear timeout:', err.message));
      didSomething = true;
    }

    if (guildConfig.mute_role_id && member.roles.cache.has(guildConfig.mute_role_id)) {
      await member.roles.remove(guildConfig.mute_role_id, reason ?? undefined).catch((err) => logger.warn('Failed to remove mute role:', err.message));
      didSomething = true;
    }

    const activeSanction = await getActiveSanction(interaction.guild.id, user.id, ['mute', 'tempmute']);
    if (activeSanction) {
      await deactivateCase(interaction.guild.id, activeSanction.case_number);
      didSomething = true;
    }

    if (!didSomething) {
      skipped.push(user);
      continue;
    }

    const modCase = await createCase({ guildId: interaction.guild.id, userId: user.id, moderatorId: interaction.user.id, type: 'unmute', reason });
    caseNumbers.push(modCase.case_number);
    succeeded.push(user);
    await logSanction(interaction.client, interaction.guild, { modCase, target: user, moderator: interaction.user, reason });

    await member
      .send(await sanctionDM({ type: 'unmute', guild: interaction.guild, client: interaction.client, reason, member: member, moderator: interaction.user, caseNumber: modCase.case_number }))
      .catch(() => logger.warn(`Could not DM unmute notice to ${user.id} in guild ${interaction.guild.id}.`));
  }

  const lines = [tn(lang, 'moderation.unmute.bulkDone', succeeded.length, { emoji: EMOJI.APPROVE, count: succeeded.length, cases: caseNumbers.length ? t(lang, 'moderation.common.cases', { list: caseNumberList(lang, caseNumbers) }) : '' })];
  if (succeeded.length) lines.push(mentionList(lang, succeeded));
  if (skipped.length) lines.push(t(lang, 'moderation.unmute.skipped', { list: mentionList(lang, skipped) }));
  if (blocked.length) lines.push(protectedLine(blocked, lang));
  if (notFound.length) lines.push(t(lang, 'moderation.common.notFound', { list: listWithMore(lang, notFound, { format: (id) => `\`${id}\`` }) }));

  const card = textCard(lines.join('\n'), 0xa5ea7a);
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
}

/** `mute list` (`!timeout list`): who cannot talk right now, by timeout (with when it ends) or by the mute role. */
async function listMuted(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const guildConfig = await ensureGuild(interaction.guild.id).catch(() => null);
  const muteRoleId = guildConfig?.mute_role_id ?? null;
  const members = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
  const now = Date.now();
  const rows = [...members.values()]
    .map((member) => ({ member, until: member.communicationDisabledUntilTimestamp > now ? member.communicationDisabledUntilTimestamp : null, role: Boolean(muteRoleId && member.roles.cache.has(muteRoleId)) }))
    .filter((row) => row.until || row.role)
    .sort((a, b) => (a.until ?? Infinity) - (b.until ?? Infinity));

  if (!rows.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.mute.listEmpty'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const lines = rows.slice(0, 40).map(({ member, until, role }) => [
    `${member} \`${member.id}\``,
    until ? t(lang, 'moderation.mute.listUntil', { time: `<t:${Math.floor(until / 1000)}:R>` }) : null,
    role ? t(lang, 'moderation.mute.listRole') : null,
  ].filter(Boolean).join(' · '));
  if (rows.length > 40) lines.push(t(lang, 'moderation.role.more', { count: rows.length - 40 }));
  const text = [tn(lang, 'moderation.mute.listTitle', rows.length, { count: rows.length }), ...lines].join('\n');
  await interaction.editReply({ components: [textCard(text.slice(0, 3900))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}
