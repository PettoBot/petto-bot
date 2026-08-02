const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const inviteTrackingDb = require('../../db/inviteTracking');
const { COLORS } = require('../../utils/colors');

module.exports = {
  aliases: ['invs'],
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Shows how many members someone has invited.')
    .addSubcommand((s) => s.setName('user').setDescription('Check a member (default: you).').addUserOption((o) => o.setName('user').setDescription('User').setRequired(false)))
    .addSubcommand((s) => s.setName('top').setDescription('Invite leaderboard for this server.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'top') return topCmd(interaction);
    return userCmd(interaction);
  },
};

async function userCmd(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const stats = await inviteTrackingDb.getStats(interaction.guild.id, user.id);
  const net = stats.joins - stats.leaves;

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .addFields({ name: 'Invites', value: `**${net}** net (${stats.joins} joined, ${stats.leaves} left)`, inline: false });

  await interaction.reply({ embeds: [embed] });
}

async function topCmd(interaction) {
  const rows = await inviteTrackingDb.getLeaderboard(interaction.guild.id, 10);
  const lines = rows.length
    ? rows.map((r, i) => `**${i + 1}.** <@${r.inviter_id}> — **${r.joins - r.leaves}** net (${r.joins} joined, ${r.leaves} left)`).join('\n')
    : 'No tracked invites yet.';

  const embed = new EmbedBuilder().setColor(COLORS.BLUE).setTitle(`Invite leaderboard — ${interaction.guild.name}`).setDescription(lines);
  await interaction.reply({ embeds: [embed] });
}
