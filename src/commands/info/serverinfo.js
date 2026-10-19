const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { serverInfoPayload } = require('../../utils/serverInfoCard');
const { noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

// The catalog key of each verification level, in Discord's order.
const VERIFICATION_LEVELS = ['none', 'low', 'medium', 'high', 'highest'].map((level) => `info.serverinfo.verification.${level}`);
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
  // Also registered as a slash command (one of the everyday ones people look for with `/`); the prefix keeps working.
  registerSlash: true,
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDMPermission(false)
    .setDescription('Shows information about this server.')
    .addStringOption((o) => o.setName('server').setDescription('ID of another server Petto is in').setRequired(false)),
  aliases: ['si', 'server'],

  async execute(interaction) {
    const lang = await languageOf(interaction);
    // With an ID it tells about another server, but only one that Petto is in and the person is a member of.
    const wanted = interaction.options.getString('server')?.trim();
    let guild = interaction.guild;
    if (wanted && wanted !== guild?.id) {
      const other = /^\d{15,25}$/.test(wanted) ? interaction.client.guilds.cache.get(wanted) : null;
      const member = other ? await other.members.fetch(interaction.user.id).catch(() => null) : null;
      if (!member) {
        await interaction.reply({ ...noticePayload(t(lang, 'info.serverinfo.notFound'), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
      }
      guild = other;
    }
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
      verification: t(lang, VERIFICATION_LEVELS[guild.verificationLevel] ?? 'info.serverinfo.verification.unknown'),
      locale: guild.preferredLocale,
      textChannels, forumChannels, voiceChannels, categories,
      roles: Math.max(0, guild.roles.cache.size - 1),
      emojis: guild.emojis.cache.size, emojiLimit: EMOJI_LIMITS[tier],
      stickers: guild.stickers.cache.size, stickerLimit: STICKER_LIMITS[tier],
      features: [...(fresh?.features ?? guild.features ?? [])],
      shard: guild.shardId + 1, shards: shardCount,
      lang,
    }));
  },
};
