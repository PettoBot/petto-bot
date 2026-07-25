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
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild?.members.cache.get(user.id);

    const badges = user.flags?.toArray().map((f) => BADGE_NAMES[f] ?? f).filter(Boolean) ?? [];
    const joinPos = member ? joinPosition(interaction.guild, member) : null;

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || COLORS.BLUE)
      .setAuthor({ name: `${user.username}`, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 512 }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Bot?', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>\n(<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`, inline: false },
      );

    if (member) {
      embed.addFields({ name: 'Joined server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n(<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)${joinPos ? ` — #${joinPos}` : ''}`, inline: false });
      if (member.premiumSinceTimestamp) embed.addFields({ name: 'Boosting since', value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`, inline: true });

      const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position);
      embed.addFields({ name: `Roles (${roles.size})`, value: roles.size ? roles.map((r) => `${r}`).join(' ').slice(0, 1000) : 'None', inline: false });
    }

    if (badges.length) embed.addFields({ name: 'Badges', value: badges.join(', '), inline: false });

    await interaction.reply({ embeds: [embed] });
  },
};
