const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { COLORS } = require('../../utils/colors');

const VERIFICATION_LEVELS = ['None', 'Low', 'Medium', 'High', 'Highest'];
const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);
const VOICE_CHANNEL_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

function linkOrText(url) {
  return url ? '[View](' + url + ')' : 'Not set';
}

function premiumTierLabel(tier) {
  if (tier === 'NONE') return 'No level';
  return tier?.replace('TIER_', 'Level ') ?? 'No level';
}

module.exports = {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Shows information about this server.'),
  aliases: ['si', 'server'],

  async execute(interaction) {
    const guild = interaction.guild;
    const owner = await guild.fetchOwner().catch(() => null);
    const humans = guild.members.cache.filter((member) => !member.user.bot).size;
    const bots = guild.members.cache.filter((member) => member.user.bot).size;
    const textChannels = guild.channels.cache.filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type)).size;
    const voiceChannels = guild.channels.cache.filter((channel) => VOICE_CHANNEL_TYPES.has(channel.type)).size;
    const categories = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).size;
    const roleCount = Math.max(0, guild.roles.cache.size - 1);
    const emojiCount = guild.emojis.cache.size;
    const boosterCount = guild.members.cache.filter((member) => member.premiumSince).size;
    const createdAt = Math.floor(guild.createdTimestamp / 1000);
    const shardCount = interaction.client.ws?.shards?.size ?? 1;
    const verification = VERIFICATION_LEVELS[guild.verificationLevel] ?? 'Unknown';
    const maxEmojis = guild.maximumEmojis ?? 'Not available';
    const totalChannels = textChannels + voiceChannels + categories;

    const embed = new EmbedBuilder()
      .setColor(COLORS.BLUE)
      .setAuthor({ name: 'Server overview · ' + guild.name, iconURL: guild.iconURL() ?? undefined })
      .setTitle(guild.name)
      .setDescription(
        'Server created on <t:' + createdAt + ':D> (<t:' + createdAt + ':R>)\n' +
        'Petto is running on shard ' + guild.shardId + '/' + Math.max(1, shardCount) + '.',
      )
      .setThumbnail(guild.iconURL({ size: 512 }) ?? null)
      .addFields(
        { name: 'Owner', value: owner?.user?.username ?? 'Unknown', inline: true },
        { name: 'Members', value: 'Total: ' + guild.memberCount + '\nHumans: ' + humans + '\nBots: ' + bots, inline: true },
        { name: 'Information', value: 'Verification: ' + verification + '\nBoosts: ' + (guild.premiumSubscriptionCount ?? 0) + ' (' + premiumTierLabel(guild.premiumTier) + ')', inline: true },
        {
          name: 'Design',
          value: [
            'Splash: ' + linkOrText(guild.splashURL({ size: 1024 })),
            'Banner: ' + linkOrText(guild.bannerURL({ size: 1024 })),
            'Icon: ' + linkOrText(guild.iconURL({ size: 1024 })),
          ].join('\n'),
          inline: true,
        },
        { name: 'Channels (' + totalChannels + ')', value: 'Text: ' + textChannels + '\nVoice: ' + voiceChannels + '\nCategory: ' + categories, inline: true },
        { name: 'Counts', value: ['Roles: ' + roleCount + '/250', 'Emojis: ' + emojiCount + '/' + maxEmojis, 'Boosters: ' + boosterCount].join('\n'), inline: true },
      )
      .setFooter({ text: 'Guild ID: ' + guild.id + ' · ' + interaction.client.user.username });

    await interaction.reply({ embeds: [embed] });
  },
};
