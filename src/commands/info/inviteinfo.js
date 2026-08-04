const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

module.exports = {
  aliases: ['ii'],
  data: new SlashCommandBuilder()
    .setName('inviteinfo')
    .setDescription('Shows information about an invite code.')
    .addStringOption((o) => o.setName('code').setDescription('Invite code or link').setRequired(true)),

  async execute(interaction) {
    const raw = interaction.options.getString('code', true).trim();
    const code = raw.split('/').pop();

    const invite = await interaction.client.fetchInvite(code).catch(() => null);
    if (!invite) {
      await interaction.reply({ content: "That invite doesn't exist or has expired." });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.DEFAULT)
      .setTitle(`Invite: ${invite.code}`)
      .addFields(
        { name: 'Server', value: invite.guild?.name ?? 'Unknown', inline: true },
        { name: 'Channel', value: invite.channel ? `#${invite.channel.name}` : 'Unknown', inline: true },
        { name: 'Inviter', value: invite.inviter ? `${invite.inviter.tag}` : 'Unknown', inline: true },
        { name: 'Members', value: `${invite.memberCount ?? invite.guild?.memberCount ?? '?'}`, inline: true },
        { name: 'Expires', value: invite.expiresTimestamp ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : 'Never', inline: true },
      );

    if (invite.guild?.iconURL()) embed.setThumbnail(invite.guild.iconURL({ size: 256 }));
    await interaction.reply({ embeds: [embed] });
  },
};
