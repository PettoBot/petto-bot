const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { serverInfoPayload } = require('../../utils/serverInfoCard');

const VERIFICATION_LEVELS = ['None', 'Low', 'Medium', 'High', 'Highest'];
const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const FORUM_CHANNEL_TYPES = new Set([ChannelType.GuildForum, ChannelType.GuildMedia]);
const VOICE_CHANNEL_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const STICKER_LIMITS = [5, 15, 30, 60];
const EMOJI_LIMITS = [100, 200, 300, 500];

function premiumTierNumber(tier) {
  if (typeof tier === 'number') return Math.max(0, Math.min(3, tier));
  const normalized = String(tier ?? '').toUpperCase();
  if (!normalized || normalized === 'NONE') return 0;
  if (normalized.startsWith('TIER_')) return premiumTierNumber(normalized.slice(5));
  if (/^\d+$/.test(normalized)) return Math.max(0, Math.min(3, Number(normalized)));
  return 0;
}

module.exports = {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Shows information about this server.'),
  aliases: ['si', 'server'],

  async execute(interaction) {
    const guild = interaction.guild;
    // The server's description is not always in the cached copy of the server, so it is read fresh.
    const [owner, fresh] = await Promise.all([guild.fetchOwner().catch(() => null), (typeof guild.fetch === 'function' ? guild.fetch().catch(() => null) : null)]);
    const description = fresh?.description ?? guild.description ?? null;
    const tier = premiumTierNumber(guild.premiumTier);
    const channels = [...guild.channels.cache.values()];
    const count = (types) => channels.filter((channel) => types.has(channel.type)).length;
    const textChannels = count(TEXT_CHANNEL_TYPES);
    const forumChannels = count(FORUM_CHANNEL_TYPES);
    const voiceChannels = count(VOICE_CHANNEL_TYPES);
    const categories = channels.filter((channel) => channel.type === ChannelType.GuildCategory).length;

    // Humans, bots and boosters come from the member cache, so they are only exact once every member is cached.
    const cacheComplete = guild.members.cache.size >= guild.memberCount;
    const humans = cacheComplete ? guild.members.cache.filter((member) => !member.user.bot).size : null;
    const bots = cacheComplete ? guild.members.cache.filter((member) => member.user.bot).size : null;
    const boosters = cacheComplete ? guild.members.cache.filter((member) => member.premiumSince).size : null;

    const iconUrl = guild.iconURL({ size: 512 });
    const shardCount = Math.max(1, interaction.client.ws?.shards?.size ?? 1);

    await interaction.reply(serverInfoPayload({
      name: guild.name,
      id: guild.id,
      description,
      createdTimestamp: guild.createdTimestamp,
      ownerId: owner?.id ?? guild.ownerId ?? null,
      iconUrl,
      bannerUrl: guild.bannerURL({ size: 1024 }),
      splashUrl: guild.splashURL({ size: 1024 }),
      vanityUrl: guild.vanityURLCode ? `https://discord.gg/${guild.vanityURLCode}` : null,
      memberCount: guild.memberCount,
      humans, bots, boosters,
      boosts: guild.premiumSubscriptionCount ?? 0,
      tier,
      verification: VERIFICATION_LEVELS[guild.verificationLevel] ?? 'Unknown',
      locale: guild.preferredLocale,
      textChannels, forumChannels, voiceChannels, categories,
      roles: Math.max(0, guild.roles.cache.size - 1),
      emojis: guild.emojis.cache.size, emojiLimit: EMOJI_LIMITS[tier],
      stickers: guild.stickers.cache.size, stickerLimit: STICKER_LIMITS[tier],
      features: [...(fresh?.features ?? guild.features ?? [])],
      shard: guild.shardId + 1, shards: shardCount,
    }));
  },
};
