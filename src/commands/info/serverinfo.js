const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { COLORS } = require('../../utils/colors');

module.exports = {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Shows information about this server.'),
  aliases: ['si', 'server'],

  async execute(interaction) {
    const guild = interaction.guild;
    const owner = await guild.fetchOwner().catch(() => null);

    const humans = guild.members.cache.filter((m) => !m.user.bot).size;
    const bots = guild.members.cache.filter((m) => m.user.bot).size;
    const textChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).size;
    const voiceChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size;

    const embed = new EmbedBuilder()
      .setColor(COLORS.BLUE)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
      .setThumbnail(guild.iconURL({ size: 512 }) ?? null)
      .addFields(
        { name: 'Owner', value: owner ? `${owner.user}` : 'Unknown', inline: true },
        { name: 'Server ID', value: guild.id, inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Members', value: `${guild.memberCount} total\n${humans} humans, ${bots} bots`, inline: true },
        { name: 'Channels', value: `${textChannels} text, ${voiceChannels} voice`, inline: true },
        { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Boosts', value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} boosts)`, inline: true },
        { name: 'Emojis', value: `${guild.emojis.cache.size}`, inline: true },
      );

    if (guild.vanityURLCode) embed.addFields({ name: 'Vanity URL', value: `discord.gg/${guild.vanityURLCode}`, inline: true });
    if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));

    await interaction.reply({ embeds: [embed] });
  },
};
