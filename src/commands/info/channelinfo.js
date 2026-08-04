const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { COLORS } = require('../../utils/colors');

const TYPE_NAMES = {
  [ChannelType.GuildText]: 'Text',
  [ChannelType.GuildVoice]: 'Voice',
  [ChannelType.GuildAnnouncement]: 'Announcement',
  [ChannelType.GuildStageVoice]: 'Stage',
  [ChannelType.GuildForum]: 'Forum',
  [ChannelType.GuildCategory]: 'Category',
  [ChannelType.PublicThread]: 'Thread',
  [ChannelType.PrivateThread]: 'Private Thread',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channelinfo')
    .setDescription('Shows information about a channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)').setRequired(false)),
  aliases: ['ci'],

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;

    const embed = new EmbedBuilder()
      .setColor(COLORS.DEFAULT)
      .setTitle(`#${channel.name}`)
      .addFields(
        { name: 'ID', value: channel.id, inline: true },
        { name: 'Type', value: TYPE_NAMES[channel.type] ?? String(channel.type), inline: true },
        { name: 'Created', value: `<t:${Math.floor(channel.createdTimestamp / 1000)}:R>`, inline: true },
      );

    if (channel.parent) embed.addFields({ name: 'Category', value: channel.parent.name, inline: true });
    if ('topic' in channel && channel.topic) embed.addFields({ name: 'Topic', value: channel.topic, inline: false });
    if ('nsfw' in channel) embed.addFields({ name: 'NSFW', value: channel.nsfw ? 'Yes' : 'No', inline: true });
    if ('rateLimitPerUser' in channel && channel.rateLimitPerUser) embed.addFields({ name: 'Slowmode', value: `${channel.rateLimitPerUser}s`, inline: true });
    if ('bitrate' in channel) embed.addFields({ name: 'Bitrate', value: `${channel.bitrate / 1000}kbps`, inline: true });
    if ('userLimit' in channel && channel.userLimit) embed.addFields({ name: 'User limit', value: `${channel.userLimit}`, inline: true });

    await interaction.reply({ embeds: [embed] });
  },
};
