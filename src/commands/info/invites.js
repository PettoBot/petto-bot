const { SlashCommandBuilder } = require('discord.js');
const inviteTrackingDb = require('../../db/inviteTracking');
const { INFO_ACCENT, infoPayload, noticePayload, line } = require('../../utils/infoCard');

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

  await interaction.reply(infoPayload({
    accent: interaction.guild.members.cache.get(user.id)?.displayColor || INFO_ACCENT,
    title: `${user.globalName ?? user.username}'s invites`,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    subtitle: [`**${net}** net invites`],
    sections: [{ lines: [line('Joined', stats.joins), line('Left', stats.leaves)] }],
    footer: `ID ${user.id}`,
  }));
}

async function topCmd(interaction) {
  const rows = await inviteTrackingDb.getLeaderboard(interaction.guild.id, 10);
  if (!rows.length) {
    await interaction.reply(noticePayload('No tracked invites yet.'));
    return;
  }

  const lines = rows.map((r, i) => `**${i + 1}.** <@${r.inviter_id}> · **${r.joins - r.leaves}** net (${r.joins} joined, ${r.leaves} left)`);
  await interaction.reply(infoPayload({
    title: 'Invite leaderboard',
    thumbnail: interaction.guild.iconURL({ size: 256 }),
    subtitle: [interaction.guild.name],
    sections: [{ lines }],
    footer: 'Top 10 by net invites',
  }));
}
