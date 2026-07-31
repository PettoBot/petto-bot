const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { createCase } = require('../../db/modActions');
const { canModerate } = require('../../utils/permissions');
const { buildCaseCard, textCard } = require('../../utils/caseCard');
const { logSanction } = require('../../utils/caseLog');
const { buildSanctionDM } = require('../../utils/sanctionMessage');
const logger = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('softban')
    .setDescription("Ban and immediately unban a member, to wipe their recent messages without a lasting ban.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('user').setDescription('The member to softban').setRequired(true))
    .addIntegerOption((opt) => opt.setName('delete_message_days').setDescription('Delete this many days of their recent messages (0-7)').setMinValue(0).setMaxValue(7).setRequired(false))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the softban').setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason');
    const deleteDays = interaction.options.getInteger('delete_message_days') ?? 1;

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    const check = canModerate(interaction, targetMember, PermissionFlagsBits.BanMembers);
    if (!check.ok) {
      await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    if (targetMember) {
      await targetMember
        .send(buildSanctionDM({ type: 'softban', guild: interaction.guild, client: interaction.client, reason }))
        .catch(() => logger.warn(`Could not DM softban notice to ${targetUser.id} in guild ${interaction.guild.id}.`));
    }

    try {
      await interaction.guild.members.ban(targetUser.id, { reason: reason ?? undefined, deleteMessageSeconds: deleteDays * 86400 });
      await interaction.guild.members.unban(targetUser.id, 'Softban: message cleanup complete.');
    } catch (err) {
      logger.error('Failed to softban member:', err);
      await interaction.editReply({
        components: [textCard('I was unable to softban that user. They may already be banned, or I lack permission.', 0xfe6465)],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    await ensureGuild(interaction.guild.id);
    const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'softban', reason });

    const card = buildCaseCard({ caseNumber: modCase.case_number, type: 'softban', target: targetUser, moderator: interaction.user, reason });
    await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
    await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });
  },
};
