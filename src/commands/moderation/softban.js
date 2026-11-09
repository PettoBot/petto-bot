const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { createCase } = require('../../db/modActions');
const { canModerate } = require('../../utils/permissions');
const { textCard } = require('../../utils/caseCard');
const { logSanction } = require('../../utils/caseLog');
const { sanctionDM, sanctionReply, updateSanctionDm } = require('../../utils/sanctionTemplates');
const logger = require('../../utils/logger');
const { failureDetail } = require('../../utils/moderationCommand');
const { t, languageOf } = require('../../i18n');
const { sendDm } = require('../../utils/dmOrigin');

module.exports = {
  // A slash command of its own (`/softban`), not a subcommand of `/mod`.
  registerSlash: true,
  aliases: ['sb', 'sofban'],
  data: new SlashCommandBuilder()
    .setName('softban')
    .setDescription("Ban and immediately unban a member, to wipe their recent messages without a lasting ban.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('user').setDescription('The member to softban').setRequired(true))
    .addIntegerOption((opt) => opt.setName('delete_message_days').setDescription('Delete this many days of their recent messages (0-7)').setMinValue(0).setMaxValue(7).setRequired(false))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the softban').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
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

    const dmOptions = { type: 'softban', guild: interaction.guild, client: interaction.client, reason, member: targetMember, moderator: interaction.user };
    let dm = null;
    if (targetMember) {
      dm = await sendDm(targetMember, await sanctionDM(dmOptions))
        .catch(() => { logger.warn(`Could not DM softban notice to ${targetUser.id} in guild ${interaction.guild.id}.`); return null; });
    }

    try {
      await interaction.guild.members.ban(targetUser.id, { reason: reason ?? undefined, deleteMessageSeconds: deleteDays * 86400 });
      await interaction.guild.members.unban(targetUser.id, t(lang, 'moderation.softban.audit'));
    } catch (err) {
      logger.error('Failed to softban member:', err);
      await interaction.editReply({
        components: [textCard(t(lang, 'moderation.softban.failed', { detail: failureDetail(err, lang) }), 0xfe6465)],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    await ensureGuild(interaction.guild.id);
    const modCase = await createCase({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, type: 'softban', reason });
    await updateSanctionDm(dm, { ...dmOptions, caseNumber: modCase.case_number });

    await sanctionReply(interaction, { modCase, type: 'softban', target: targetUser, moderator: interaction.user, reason });
    await logSanction(interaction.client, interaction.guild, { modCase, target: targetUser, moderator: interaction.user, reason });
  },
};
