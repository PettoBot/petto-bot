const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

module.exports = {
  aliases: ['n'],
  data: new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Clone this channel (same settings, empty) and delete the original, to instantly clear all messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    const channel = interaction.channel;

    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      await interaction.reply({ content: 'This channel type cannot be nuked.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: 'I need the **Manage Channels** permission in this channel.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const position = channel.position;
      const clone = await channel.clone({ reason: `Nuked by ${interaction.user.tag}` });
      await clone.setPosition(position).catch(() => {});
      await channel.delete(`Nuked by ${interaction.user.tag}`);
      await clone.send({ components: [textCard(`${EMOJI.APPROVE}  This channel was nuked by ${interaction.user}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
      await interaction.editReply(`${EMOJI.APPROVE} Done — ${clone}.`);
    } catch (err) {
      logger.error('Failed to nuke channel:', err);
      await interaction.editReply('I was unable to nuke that channel.').catch(() => {});
    }
  },
};
