const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['n'],
  data: new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Clone this channel (same settings, empty) and delete the original, to instantly clear all messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const channel = interaction.channel;

    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      await interaction.reply({ content: t(lang, 'moderation.nuke.wrongType'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: t(lang, 'moderation.nuke.needsManageChannels'), flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const position = channel.position;
      const auditReason = t(lang, 'moderation.nuke.audit', { user: interaction.user.tag });
      const clone = await channel.clone({ reason: auditReason });
      await clone.setPosition(position).catch(() => {});
      await channel.delete(auditReason);
      await clone.send({ components: [textCard(t(lang, 'moderation.nuke.done', { emoji: EMOJI.APPROVE, user: `${interaction.user}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
      // The channel the command was written in is gone, so with the prefix the message in the new channel is the answer.
      if (!interaction.rawMessage) await interaction.editReply(t(lang, 'moderation.nuke.doneReply', { emoji: EMOJI.APPROVE, channel: `${clone}` })).catch(() => {});
    } catch (err) {
      logger.error('Failed to nuke channel:', err);
      await interaction.editReply(t(lang, 'moderation.nuke.failed')).catch(() => {});
    }
  },
};
