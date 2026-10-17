const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { createCase } = require('../../db/modActions');
const { canModerate } = require('../../utils/permissions');
const { textCard } = require('../../utils/caseCard');
const { logSanction } = require('../../utils/caseLog');
const { sanctionDM, sanctionReply } = require('../../utils/sanctionTemplates');
const { resolveUsers } = require('../../utils/userResolve');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { confirmBulkAction, requireAdministrator, failureDetail, bulkTargetBlocked, protectedLine } = require('../../utils/moderationCommand');
const { reasonText } = require('../../utils/caseFormat');
const { t, tn, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['k'],
  prefixDefaultSubcommand: 'user',
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick members from the server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Kick a single member.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to kick').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the kick').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('users')
        .setDescription('Kick multiple members with the same reason.')
        .addStringOption((opt) => opt.setName('users').setDescription('Mentions, IDs, or exact usernames; separate with spaces or commas').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the kicks').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'user') return kickUser(interaction);
    return kickUsers(interaction);
  },
};

async function kickUser(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.KickMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  await targetMember
    .send(await sanctionDM({ type: 'kick', guild: interaction.guild, client: interaction.client, reason, member: targetMember, moderator: interaction.user }))
    .catch(() => logger.warn(`Could not DM kick notice to ${targetUser.id} in guild ${interaction.guild.id}.`));

  try {
    await targetMember.kick(reason ?? undefined);
  } catch (err) {
    logger.error('Failed to kick member:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.kick.failed', { detail: failureDetail(err, lang) }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await ensureGuild(interaction.guild.id);
  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'kick', reason });

  await sanctionReply(interaction, { modCase, type: 'kick', target: targetUser, moderator: interaction.user, reason });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });
}

async function kickUsers(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const usersInput = interaction.options.getString('users', true);
  const reason = interaction.options.getString('reason');

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
    await interaction.reply({ content: t(lang, 'moderation.kick.needsKickMembers'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  if (!(await confirmBulkAction(interaction, 'kick', usersInput))) return;

  const { users, failed: notFound } = await resolveUsers(interaction.client, usersInput, interaction.guild);
  await ensureGuild(interaction.guild.id);

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
    if (bulkTargetBlocked(interaction, member, PermissionFlagsBits.KickMembers)) {
      blocked.push(user);
      continue;
    }

    try {
      await member
        .send(await sanctionDM({ type: 'kick', guild: interaction.guild, client: interaction.client, reason, member: member, moderator: interaction.user }))
        .catch(() => logger.warn(`Could not DM kick notice to ${user.id} in guild ${interaction.guild.id}.`));
      await member.kick(reason ?? undefined);
      const modCase = await createCase({ guildId: interaction.guild.id, userId: user.id, moderatorId: interaction.user.id, type: 'kick', reason });
      caseNumbers.push(modCase.case_number);
      succeeded.push(user);
      await logSanction(interaction.client, interaction.guild, { modCase, target: user, moderator: interaction.user, reason });
    } catch (err) {
      logger.warn(`kick users: failed to kick ${user.id}:`, err.message);
      failed.push(user);
    }
  }

  const lines = [tn(lang, 'moderation.kick.bulkDone', succeeded.length, { emoji: EMOJI.APPROVE, count: succeeded.length, cases: caseNumbers.length ? t(lang, 'moderation.common.cases', { list: caseNumbers.join(', #') }) : '' })];
  if (succeeded.length) lines.push(succeeded.map((u) => `${u}`).join(' '));
  if (failed.length) lines.push(t(lang, 'moderation.common.failedList', { emoji: EMOJI.DENY, list: failed.map((u) => `${u}`).join(' ') }));
  if (skipped.length) lines.push(t(lang, 'moderation.common.notInServer', { list: skipped.map((u) => `${u}`).join(' ') }));
  if (blocked.length) lines.push(protectedLine(blocked, lang));
  if (notFound.length) lines.push(t(lang, 'moderation.common.notFound', { list: notFound.map((id) => `\`${id}\``).join(', ') }));
  lines.push(t(lang, 'moderation.common.reason', { reason: reasonText(reason, lang) }));

  const card = textCard(lines.join('\n'), 0xfed53c);
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
}
