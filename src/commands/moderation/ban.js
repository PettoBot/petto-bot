const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { createCase, getActiveSanction, deactivateCase } = require('../../db/modActions');
const { canModerate } = require('../../utils/permissions');
const { textCard } = require('../../utils/caseCard');
const { logSanction } = require('../../utils/caseLog');
const { sendLog } = require('../../logging/engine');
const { sanctionDM, sanctionReply } = require('../../utils/sanctionTemplates');
const { resolveUsers } = require('../../utils/userResolve');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { addHardBan, getHardBan, removeHardBan, canLiftHardBan, listHardBanIds } = require('../../db/hardBans');
const { confirmBulkAction, requireAdministrator, failureDetail } = require('../../utils/moderationCommand');
const { reasonText } = require('../../utils/caseFormat');
const { t, tn, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['b'],
  prefixDefaultSubcommand: 'user',
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban members from the server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Ban a single member.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to ban').setRequired(true))
        .addIntegerOption((opt) => opt.setName('delete_message_days').setDescription("Delete this many days of the user's recent messages (0-7)").setMinValue(0).setMaxValue(7).setRequired(false))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the ban').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('users')
        .setDescription('Ban multiple members with the same reason.')
        .addStringOption((opt) => opt.setName('users').setDescription('Mentions, IDs, or exact usernames; separate with spaces or commas').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the bans').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('temp')
        .setDescription('Temporarily ban a member.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to ban').setRequired(true))
        .addStringOption((opt) => opt.setName('duration').setDescription('e.g. 1d, 12h, 2w').setRequired(true))
        .addIntegerOption((opt) => opt.setName('delete_message_days').setDescription("Delete this many days of the user's recent messages (0-7)").setMinValue(0).setMaxValue(7).setRequired(false))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the ban').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove the ban of a user so they can join again.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to unban (by ID if they left no trace)').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the unban').setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName('remove-all').setDescription('Unban every currently banned user (requires Administrator).').addStringOption((opt) => opt.setName('reason').setDescription('Reason for the mass unban').setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'user') return banUser(interaction);
    if (sub === 'users') return banUsers(interaction);
    if (sub === 'temp') return tempBan(interaction);
    if (sub === 'remove') return unban(interaction);
    if (sub === 'remove-all') return unbanAll(interaction);
  },
  hardBanUser: (interaction) => banUser(interaction, { hard: true }),
};

async function banUser(interaction, { hard = false } = {}) {
  const lang = await languageOf(interaction);
  const type = hard ? 'hardban' : 'ban';
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');
  const deleteDays = interaction.options.getInteger('delete_message_days') ?? 0;

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.BanMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  // Best-effort: DM before the ban, since the bot can't message someone it no longer shares a server with.
  if (targetMember) {
    await targetMember
      .send(await sanctionDM({ type, guild: interaction.guild, client: interaction.client, reason, member: targetMember, moderator: interaction.user }))
      .catch(() => logger.warn(`Could not DM ban notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
  }

  try {
    await interaction.guild.members.ban(targetUser.id, { reason: reason ?? undefined, deleteMessageSeconds: deleteDays * 86400 });
  } catch (err) {
    logger.error('Failed to ban member:', err);
    await interaction.editReply({
      components: [textCard(t(lang, 'moderation.ban.failed', { detail: failureDetail(err, lang) }), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  await ensureGuild(interaction.guild.id);
  if (hard) await addHardBan(interaction.guild.id, targetUser.id, interaction.user.id, reason);
  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type, reason });

  await sanctionReply(interaction, { modCase, type, target: targetUser, moderator: interaction.user, reason });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });
}

async function banUsers(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const usersInput = interaction.options.getString('users', true);
  const reason = interaction.options.getString('reason');

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    await interaction.reply({ content: t(lang, 'moderation.ban.needsBanMembers'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  if (!(await confirmBulkAction(interaction, 'ban', usersInput))) return;

  const { users, failed: notFound } = await resolveUsers(interaction.client, usersInput, interaction.guild);
  await ensureGuild(interaction.guild.id);

  const succeeded = [];
  const failed = [];
  const caseNumbers = [];

  for (const user of users) {
    try {
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        await member
          .send(await sanctionDM({ type: 'ban', guild: interaction.guild, client: interaction.client, reason, member: member, moderator: interaction.user }))
          .catch(() => logger.warn(`Could not DM ban notice to ${user.id} in guild ${interaction.guild.id}.`));
      }
      await interaction.guild.members.ban(user.id, { reason: reason ?? undefined });
      const modCase = await createCase({ guildId: interaction.guild.id, userId: user.id, moderatorId: interaction.user.id, type: 'ban', reason });
      caseNumbers.push(modCase.case_number);
      succeeded.push(user);
      await logSanction(interaction.client, interaction.guild, { modCase, target: user, moderator: interaction.user, reason });
    } catch (err) {
      logger.warn(`ban users: failed to ban ${user.id}:`, err.message);
      failed.push(user);
    }
  }

  const lines = [tn(lang, 'moderation.ban.bulkDone', succeeded.length, { emoji: EMOJI.APPROVE, count: succeeded.length, cases: caseNumbers.length ? t(lang, 'moderation.common.cases', { list: caseNumbers.join(', #') }) : '' })];
  if (succeeded.length) lines.push(succeeded.map((u) => `${u}`).join(' '));
  if (failed.length) lines.push(t(lang, 'moderation.common.failedList', { emoji: EMOJI.DENY, list: failed.map((u) => `${u}`).join(' ') }));
  if (notFound.length) lines.push(t(lang, 'moderation.common.notFound', { list: notFound.map((id) => `\`${id}\``).join(', ') }));
  lines.push(t(lang, 'moderation.common.reason', { reason: reasonText(reason, lang) }));

  const card = textCard(lines.join('\n'), 0xfe6465);
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
}

async function tempBan(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');
  const deleteDays = interaction.options.getInteger('delete_message_days') ?? 0;
  const durationMs = parseDuration(interaction.options.getString('duration', true));

  if (!durationMs) {
    await interaction.reply({ content: t(lang, 'moderation.duration.invalidBan'), flags: MessageFlags.Ephemeral });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.BanMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const duration = formatDuration(durationMs, lang);

  if (targetMember) {
    await targetMember
      .send(await sanctionDM({ type: 'tempban', guild: interaction.guild, client: interaction.client, reason, duration, member: targetMember, moderator: interaction.user }))
      .catch(() => logger.warn(`Could not DM tempban notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
  }

  try {
    await interaction.guild.members.ban(targetUser.id, { reason: reason ?? undefined, deleteMessageSeconds: deleteDays * 86400 });
  } catch (err) {
    logger.error('Failed to ban member:', err);
    await interaction.editReply({
      components: [textCard(t(lang, 'moderation.ban.failed', { detail: failureDetail(err, lang) }), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  await ensureGuild(interaction.guild.id);
  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'tempban', reason, expiresAt });

  await sanctionReply(interaction, { modCase, type: 'tempban', target: targetUser, moderator: interaction.user, reason, duration });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason, duration });
}

async function unban(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');

  const check = canModerate(interaction, null, PermissionFlagsBits.BanMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const hardBan = await getHardBan(interaction.guild.id, targetUser.id).catch(() => null);
  if (hardBan && !(await canLiftHardBan(interaction.guild, interaction.user.id))) {
    await interaction.reply({ content: t(lang, 'moderation.unban.hardban'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await interaction.guild.members.unban(targetUser.id, reason ?? undefined);
  } catch (err) {
    if (err.code === 10026) {
      await interaction.editReply({ components: [textCard(t(lang, 'moderation.unban.notBanned'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    } else {
      logger.error('Failed to unban member:', err);
      await interaction.editReply({ components: [textCard(t(lang, 'moderation.unban.failed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    }
    return;
  }

  if (hardBan) await removeHardBan(interaction.guild.id, targetUser.id);
  const activeSanction = await getActiveSanction(interaction.guild.id, targetUser.id, ['ban', 'tempban', 'hardban']);
  if (activeSanction) await deactivateCase(interaction.guild.id, activeSanction.case_number);

  await ensureGuild(interaction.guild.id);
  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'unban', reason });

  await sanctionReply(interaction, { modCase, type: 'unban', target: targetUser, moderator: interaction.user, reason });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });
}

function statusCard(text, color) {
  return textCard(text, color);
}

async function unbanAll(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: t(lang, 'moderation.unbanAll.needsAdmin'), flags: MessageFlags.Ephemeral });
    return;
  }

  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const bans = await interaction.guild.bans.fetch().catch(() => null);
  if (!bans) {
    await interaction.editReply({ components: [statusCard(t(lang, 'moderation.unbanAll.fetchFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (!bans.size) {
    await interaction.editReply({ components: [statusCard(t(lang, 'moderation.unbanAll.none'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('unbanall_confirm').setLabel(t(lang, 'moderation.unbanAll.confirm.button', { count: bans.size })).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('unbanall_cancel').setLabel(t(lang, 'moderation.bulk.cancel.button')).setStyle(ButtonStyle.Secondary),
  );

  const promptCard = statusCard(tn(lang, 'moderation.unbanAll.prompt', bans.size, { emoji: EMOJI.ALERT, count: bans.size, server: interaction.guild.name }), 0xfe6465);
  const promptMessage = await interaction.editReply({ components: [promptCard, confirmRow], flags: MessageFlags.IsComponentsV2 });

  let click;
  try {
    click = await promptMessage.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 });
  } catch {
    await interaction.editReply({ components: [statusCard(t(lang, 'moderation.unbanAll.timedOut', { emoji: EMOJI.DENY }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (click.customId === 'unbanall_cancel') {
    await click.update({ components: [statusCard(t(lang, 'moderation.unbanAll.cancelled', { emoji: EMOJI.DENY }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await click.update({ components: [statusCard(tn(lang, 'moderation.unbanAll.working', bans.size, { emoji: EMOJI.LOAD, count: bans.size }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });

  let succeeded = 0;
  let failed = 0;
  const caseNumbers = [];
  // Hard bans stay unless the one running this is the owner or an antinuke admin.
  const mayLiftHard = await canLiftHardBan(interaction.guild, interaction.user.id);
  const hardIds = mayLiftHard ? new Set() : await listHardBanIds(interaction.guild.id);
  for (const userId of bans.keys()) {
    if (hardIds.has(userId)) continue;
    let target;
    try {
      await interaction.guild.members.unban(userId, reason ?? t(lang, 'moderation.unbanAll.audit'));
      succeeded += 1;
      target = bans.get(userId)?.user ?? { id: userId, username: userId };
    } catch (err) {
      failed += 1;
      logger.warn(`unban remove-all: failed to unban ${userId} in ${interaction.guild.id}:`, err.message);
      continue;
    }

    try {
      const modCase = await createCase({ guildId: interaction.guild.id, userId, moderatorId: interaction.user.id, type: 'unban', reason });
      caseNumbers.push(modCase.case_number);
      await logSanction(interaction.client, interaction.guild, { modCase, target, moderator: interaction.user, reason });
    } catch (err) {
      logger.error(`unban remove-all: unban succeeded but case logging failed for ${userId}:`, err);
    }
  }

  const resultLines = [
    tn(lang, 'moderation.unbanAll.done', succeeded, {
      emoji: EMOJI.APPROVE,
      count: succeeded,
      failed: failed ? t(lang, 'moderation.unbanAll.failedCount', { count: failed }) : '',
      cases: caseNumbers.length ? t(lang, 'moderation.unbanAll.cases', { list: caseNumbers.join(', #') }) : '',
    }),
    t(lang, 'moderation.common.moderator', { moderator: `${interaction.user}` }),
    t(lang, 'moderation.common.reason', { reason: reasonText(reason, lang) }),
  ];
  const resultCard = statusCard(resultLines.join('\n'), 0xa5ea7a);

  await interaction.editReply({ components: [resultCard], flags: MessageFlags.IsComponentsV2 });

  await sendLog(interaction.client, interaction.guild.id, 'sanctions', {
    author: { name: tn(lang, 'moderation.unbanAll.log.author', succeeded, { name: interaction.user.username, count: succeeded }) },
    description: [
      tn(lang, 'moderation.unbanAll.log.title', succeeded, { emoji: EMOJI.APPROVE, count: succeeded, failed: failed ? t(lang, 'moderation.unbanAll.log.failed', { count: failed }) : '' }),
      t(lang, 'moderation.common.moderator', { moderator: `<@${interaction.user.id}>` }),
      t(lang, 'moderation.common.reason', { reason: reasonText(reason, lang) }),
    ].join('\n'),
    color: 0xa5ea7a,
    footer: { text: interaction.guild.name, icon_url: interaction.guild.iconURL({ extension: 'png', size: 128 }) ?? undefined },
    timestamp: new Date().toISOString(),
  });
}
