const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { infoPayload, clip, stamp, line, yesNo } = require('../../utils/infoCard');

const TYPE_NAMES = {
  [ChannelType.GuildText]: 'Text',
  [ChannelType.GuildVoice]: 'Voice',
  [ChannelType.GuildAnnouncement]: 'Announcement',
  [ChannelType.GuildStageVoice]: 'Stage',
  [ChannelType.GuildForum]: 'Forum',
  [ChannelType.GuildMedia]: 'Media',
  [ChannelType.GuildCategory]: 'Category',
  [ChannelType.PublicThread]: 'Thread',
  [ChannelType.PrivateThread]: 'Private thread',
  [ChannelType.AnnouncementThread]: 'Announcement thread',
};

function formatSeconds(seconds) {
  if (seconds >= 3600) return `${seconds / 3600}h`;
  if (seconds >= 60) return `${seconds / 60}m`;
  return `${seconds}s`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channelinfo')
    .setDescription('Shows information about a channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)').setRequired(false)),
  aliases: ['ci'],

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const isThread = typeof channel.isThread === 'function' && channel.isThread();
    const category = channel.parent && !isThread ? channel.parent : null;

    const details = [
      line('Channel', `<#${channel.id}>`),
      line('Type', TYPE_NAMES[channel.type] ?? String(channel.type)),
      line('Category', category ? clip(category.name, 100) : null),
      isThread && channel.parent ? line('Parent', `<#${channel.parent.id}>`) : null,
      channel.createdTimestamp ? line('Created', stamp(channel.createdTimestamp)) : null,
      isThread && channel.ownerId ? line('Started by', `<@${channel.ownerId}>`) : null,
    ];

    const settings = [
      'nsfw' in channel ? line('Age-restricted', yesNo(channel.nsfw)) : null,
      'rateLimitPerUser' in channel && channel.rateLimitPerUser ? line('Slowmode', formatSeconds(channel.rateLimitPerUser)) : null,
      'bitrate' in channel && channel.bitrate ? line('Bitrate', `${Math.round(channel.bitrate / 1000)} kbps`) : null,
      'userLimit' in channel && channel.userLimit ? line('User limit', channel.userLimit) : null,
      isThread ? line('Archived', yesNo(channel.archived)) : null,
      isThread ? line('Locked', yesNo(channel.locked)) : null,
      isThread && channel.memberCount !== null && channel.memberCount !== undefined ? line('Members', channel.memberCount) : null,
    ];

    await interaction.reply(infoPayload({
      title: `${isThread ? '' : '#'}${channel.name}`,
      subtitle: ['topic' in channel && channel.topic ? `> ${clip(channel.topic, 500)}` : null],
      sections: [
        { title: 'Details', lines: details },
        { title: 'Settings', lines: settings },
      ],
      footer: `ID ${channel.id}`,
    }));
  },
};
