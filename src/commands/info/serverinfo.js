const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { infoPayload, clip, stamp, line } = require('../../utils/infoCard');
const { EMOJI } = require('../../utils/emojis');

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

function premiumTierLabel(tier) {
  const level = premiumTierNumber(tier);
  return level === 0 ? 'No level' : `Level ${level}`;
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

    await interaction.reply(infoPayload({
      title: guild.name,
      thumbnail: iconUrl,
      banner: guild.bannerURL({ size: 1024 }),
      subtitle: [
        description ? `> ${clip(description, 300)}` : null,
        `${EMOJI.RELEASE_NOTE} Created ${stamp(guild.createdTimestamp)}`,
      ],
      sections: [
        {
          title: 'Overview',
          lines: [
            line('Owner', owner ? `<@${owner.id}>` : 'Unknown'),
            line('Verification', VERIFICATION_LEVELS[guild.verificationLevel] ?? 'Unknown'),
            line('Boosts', `${guild.premiumSubscriptionCount ?? 0} · ${premiumTierLabel(tier)}`),
            line('Language', guild.preferredLocale),
          ],
        },
        {
          title: 'Members',
          lines: [
            line('Total', guild.memberCount),
            humans === null ? null : line('Humans', `${humans} · **Bots** ${bots}`),
            boosters === null ? null : line('Boosters', boosters),
          ],
        },
        {
          title: `Channels (${textChannels + forumChannels + voiceChannels + categories})`,
          lines: [
            line('Text', textChannels),
            forumChannels ? line('Forums', forumChannels) : null,
            line('Voice', voiceChannels),
            line('Categories', categories),
          ],
        },
        {
          title: 'Content',
          lines: [
            line('Roles', `${Math.max(0, guild.roles.cache.size - 1)}/250`),
            line('Emojis', `${guild.emojis.cache.size}/${EMOJI_LIMITS[tier]}`),
            line('Stickers', `${guild.stickers.cache.size}/${STICKER_LIMITS[tier]}`),
          ],
        },
      ],
      footer: `ID ${guild.id} · Shard ${guild.shardId + 1}/${shardCount}`,
      buttons: [
        { label: 'Icon', url: guild.iconURL({ size: 1024 }) },
        { label: 'Banner', url: guild.bannerURL({ size: 1024 }) },
        { label: 'Invite splash', url: guild.splashURL({ size: 1024 }) },
      ],
    }));
  },
};
