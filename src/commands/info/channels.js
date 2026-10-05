const { ChannelType, SlashCommandBuilder } = require('discord.js');
const { register, sendPager } = require('../../utils/pager');

const KINDS = [
  { label: 'Every channel', value: 'all' },
  { label: 'Text channels', value: 'text' },
  { label: 'Voice channels', value: 'voice' },
  { label: 'Forums', value: 'forum' },
  { label: 'Categories', value: 'category' },
];
const MATCH = {
  text: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  voice: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
  forum: [ChannelType.GuildForum, ChannelType.GuildMedia],
  category: [ChannelType.GuildCategory],
};
const ICON = {
  [ChannelType.GuildText]: '#', [ChannelType.GuildAnnouncement]: '📢', [ChannelType.GuildVoice]: '🔊', [ChannelType.GuildStageVoice]: '🎙️',
  [ChannelType.GuildForum]: '💬', [ChannelType.GuildMedia]: '🖼️', [ChannelType.GuildCategory]: '📁',
};

register('channels', {
  async load(guild, { option }) {
    let channels = [...guild.channels.cache.values()];
    if (MATCH[option]) channels = channels.filter((channel) => MATCH[option].includes(channel.type));
    channels.sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));
    return {
      title: `Channels (${guild.channels.cache.size})`,
      subtitle: [guild.name],
      thumbnail: guild.iconURL({ size: 256 }),
      items: channels.map((channel) => `${ICON[channel.type] ?? '•'} <#${channel.id}>${channel.parent ? ` · ${channel.parent.name}` : ''}`),
      options: KINDS,
      placeholder: 'Show…',
      empty: 'This server has no channels of that kind.',
    };
  },
});

module.exports = {
  aliases: ['chs'],
  data: new SlashCommandBuilder().setName('channels').setDescription('Lists the channels of this server, a page at a time.'),

  async execute(interaction) {
    await sendPager(interaction, 'channels');
  },
};
