const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

const BADGE_NAMES = {
  Staff: 'Discord Staff',
  Partner: 'Partner',
  Hypesquad: 'HypeSquad Events',
  BugHunterLevel1: 'Bug Hunter',
  BugHunterLevel2: 'Bug Hunter (Gold)',
  HypeSquadOnlineHouse1: 'HypeSquad Bravery',
  HypeSquadOnlineHouse2: 'HypeSquad Brilliance',
  HypeSquadOnlineHouse3: 'HypeSquad Balance',
  PremiumEarlySupporter: 'Early Supporter',
  VerifiedDeveloper: 'Early Verified Bot Developer',
  CertifiedModerator: 'Certified Moderator',
  ActiveDeveloper: 'Active Developer',
};

function joinPosition(guild, member) {
  if (!member?.joinedTimestamp) return null;
  const sorted = [...guild.members.cache.values()].filter((m) => m.joinedTimestamp).sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
  const pos = sorted.findIndex((m) => m.id === member.id) + 1;
  return pos > 0 ? pos : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Shows information about a member.')
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)),
  aliases: ['ui', 'whois'],

  async execute(interaction) {
    const selectedUser = interaction.options.getUser('user') ?? interaction.user;
    const user = await interaction.client.users.fetch(selectedUser.id, { force: true }).catch(() => selectedUser);
    const member = interaction.guild
      ? await interaction.guild.members.fetch(user.id).catch(() => interaction.guild.members.cache.get(user.id) ?? null)
      : null;

    const badges = user.flags?.toArray().map((f) => BADGE_NAMES[f] ?? f).filter(Boolean) ?? [];
    const joinPos = member ? joinPosition(interaction.guild, member) : null;
    const avatar = member?.avatarURL({ size: 512 }) ?? user.displayAvatarURL({ size: 512 });
    const banner = user.bannerURL?.({ size: 1024 }) ?? null;
    const displayName = member?.displayName ?? user.globalName ?? user.username;
    const profileLinks = [`[Avatar](${avatar})`];

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || user.accentColor || COLORS.DEFAULT)
      .setAuthor({ name: displayName, iconURL: avatar })
      .setThumbnail(avatar)
      .setDescription(`<@${user.id}> · ${user.bot ? 'Bot account' : 'User account'}`)
      .addFields(
        { name: 'Username', value: `\`${user.username}\``, inline: true },
        { name: 'ID', value: `\`${user.id}\``, inline: true },
        { name: 'Links', value: profileLinks.join(' · '), inline: true },
        { name: 'Banner', value: banner ? `[Open banner](${banner})` : 'None', inline: true },
        { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>\n(<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`, inline: false },
      );

    if (member) {
      embed.addFields({ name: 'Joined server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n(<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)${joinPos ? ` — #${joinPos}` : ''}`, inline: false });
      embed.addFields({ name: 'Display name', value: member.displayName, inline: true });
      embed.addFields({ name: 'Nickname', value: member.nickname || 'None', inline: true });
      if (member.premiumSinceTimestamp) embed.addFields({ name: 'Boosting since', value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`, inline: true });

      const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position);
      embed.addFields({ name: `Roles (${roles.size})`, value: roles.size ? roles.map((r) => `${r}`).join(' ').slice(0, 1000) : 'None', inline: false });
    }

    if (banner) embed.setImage(banner);
    if (badges.length) embed.addFields({ name: 'Badges', value: badges.join(', '), inline: false });

    await interaction.reply({ embeds: [embed] });
  },
};
