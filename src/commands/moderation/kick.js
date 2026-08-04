const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { createCase } = require('../../db/modActions');
const { canModerate } = require('../../utils/permissions');
const { buildCaseCard, textCard } = require('../../utils/caseCard');
const { logSanction } = require('../../utils/caseLog');
const { buildSanctionDM } = require('../../utils/sanctionMessage');
const { resolveUsers } = require('../../utils/userResolve');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { confirmBulkAction, requireAdministrator } = require('../../utils/moderationCommand');

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
        .addStringOption((opt) => opt.setName('users').setDescription('User mentions/IDs, space or comma separated').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the kicks').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'user') return kickUser(interaction);
    return kickUsers(interaction);
  },
};

async function kickUser(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const check = canModerate(interaction, targetMember, PermissionFlagsBits.KickMembers);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  await targetMember
    .send(buildSanctionDM({ type: 'kick', guild: interaction.guild, client: interaction.client, reason }))
    .catch(() => logger.warn(`Could not DM kick notice to ${targetUser.id} in guild ${interaction.guild.id}.`));

  try {
    await targetMember.kick(reason ?? undefined);
  } catch (err) {
    logger.error('Failed to kick member:', err);
    await interaction.editReply({ components: [textCard('I was unable to kick that user.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await ensureGuild(interaction.guild.id);
  const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'kick', reason });

  const card = buildCaseCard({ caseNumber: modCase.case_number, type: 'kick', target: targetUser, moderator: interaction.user, reason });
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
  await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });
}

async function kickUsers(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const usersInput = interaction.options.getString('users', true);
  const reason = interaction.options.getString('reason');

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
    await interaction.reply({ content: 'I need the **Kick Members** permission.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  if (!(await confirmBulkAction(interaction, 'kick', usersInput))) return;

  const { users, failed: notFound } = await resolveUsers(interaction.client, usersInput);
  await ensureGuild(interaction.guild.id);

  const succeeded = [];
  const failed = [];
  const skipped = [];
  const caseNumbers = [];

  for (const user of users) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      skipped.push(user);
      continue;
    }

    try {
      await member
        .send(buildSanctionDM({ type: 'kick', guild: interaction.guild, client: interaction.client, reason }))
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

  const lines = [`${EMOJI.APPROVE}  Kicked **${succeeded.length}** user(s)${caseNumbers.length ? ` (cases #${caseNumbers.join(', #')})` : ''}.`];
  if (succeeded.length) lines.push(succeeded.map((u) => `${u}`).join(' '));
  if (failed.length) lines.push(`${EMOJI.DENY}  Failed: ${failed.map((u) => `${u}`).join(' ')}`);
  if (skipped.length) lines.push(`Not in this server: ${skipped.map((u) => `${u}`).join(' ')}`);
  if (notFound.length) lines.push(`Not found: ${notFound.map((id) => `\`${id}\``).join(', ')}`);
  lines.push(`**Reason:** ${reason || 'No reason provided.'}`);

  const card = textCard(lines.join('\n'), 0xfed53c);
  await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
}
