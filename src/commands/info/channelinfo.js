const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { infoPayload, clip, stamp, line, yesNo } = require('../../utils/infoCard');
const { t, languageOf } = require('../../i18n');

// The catalog key of the name of each kind of channel.
const TYPE_NAMES = {
  [ChannelType.GuildText]: 'info.channelinfo.type.text',
  [ChannelType.GuildVoice]: 'info.channelinfo.type.voice',
  [ChannelType.GuildAnnouncement]: 'info.channelinfo.type.announcement',
  [ChannelType.GuildStageVoice]: 'info.channelinfo.type.stage',
  [ChannelType.GuildForum]: 'info.channelinfo.type.forum',
  [ChannelType.GuildMedia]: 'info.channelinfo.type.media',
  [ChannelType.GuildCategory]: 'info.channelinfo.type.category',
  [ChannelType.PublicThread]: 'info.channelinfo.type.thread',
  [ChannelType.PrivateThread]: 'info.channelinfo.type.privateThread',
  [ChannelType.AnnouncementThread]: 'info.channelinfo.type.announcementThread',
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
    const lang = await languageOf(interaction);
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const isThread = typeof channel.isThread === 'function' && channel.isThread();
    const category = channel.parent && !isThread ? channel.parent : null;

    const details = [
      line(t(lang, 'info.label.channel'), `<#${channel.id}>`),
      line(t(lang, 'info.label.type'), TYPE_NAMES[channel.type] ? t(lang, TYPE_NAMES[channel.type]) : String(channel.type)),
      line(t(lang, 'info.label.category'), category ? clip(category.name, 100) : null),
      isThread && channel.parent ? line(t(lang, 'info.channelinfo.parent'), `<#${channel.parent.id}>`) : null,
      channel.createdTimestamp ? line(t(lang, 'info.label.created'), stamp(channel.createdTimestamp)) : null,
      isThread && channel.ownerId ? line(t(lang, 'info.channelinfo.startedBy'), `<@${channel.ownerId}>`) : null,
    ];

    const settings = [
      'nsfw' in channel ? line(t(lang, 'info.channelinfo.nsfw'), yesNo(channel.nsfw, lang)) : null,
      'rateLimitPerUser' in channel && channel.rateLimitPerUser ? line(t(lang, 'info.channelinfo.slowmode'), formatSeconds(channel.rateLimitPerUser)) : null,
      'bitrate' in channel && channel.bitrate ? line(t(lang, 'info.channelinfo.bitrate'), `${Math.round(channel.bitrate / 1000)} kbps`) : null,
      'userLimit' in channel && channel.userLimit ? line(t(lang, 'info.channelinfo.userLimit'), channel.userLimit) : null,
      isThread ? line(t(lang, 'info.channelinfo.archived'), yesNo(channel.archived, lang)) : null,
      isThread ? line(t(lang, 'info.channelinfo.locked'), yesNo(channel.locked, lang)) : null,
      isThread && channel.memberCount !== null && channel.memberCount !== undefined ? line(t(lang, 'info.label.members'), channel.memberCount) : null,
    ];

    await interaction.reply(infoPayload({
      title: `${isThread ? '' : '#'}${channel.name}`,
      subtitle: ['topic' in channel && channel.topic ? `> ${clip(channel.topic, 500)}` : null],
      sections: [
        { title: t(lang, 'info.section.details'), lines: details },
        { title: t(lang, 'info.section.settings'), lines: settings },
      ],
      footer: t(lang, 'info.card.id', { id: channel.id }),
    }));
  },
};
