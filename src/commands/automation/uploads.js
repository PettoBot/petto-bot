// Upload numbers for everyone: how many uploads a member has, and the ranking. The settings are in `!uploadconfig`.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const uploadsDb = require('../../db/uploads');
const { periodStart, rank, counts } = require('../../utils/partnerEngine');
const { textCard } = require('../../utils/caseCard');

const PERIODS = { day: 'Today', week: 'This week', all: 'All time' };
const PERIOD_WORDS = { day: 'day', today: 'day', daily: 'day', week: 'week', weekly: 'week', all: 'all', total: 'all', alltime: 'all' };
// The numbers use the same day, week and ranking rules as partners, which read `manager_id`.
const asRows = (rows) => rows.map((row) => ({ ...row, manager_id: row.user_id }));

async function stats(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const rows = await uploadsDb.listLog(interaction.guild.id, { userId: user.id });
  const total = counts(asRows(rows));
  const files = rows.reduce((sum, row) => sum + (row.files ?? 1), 0);
  const last = rows[0];
  await interaction.editReply({
    components: [textCard([`### Uploads of ${user.username}`, `Today: **${total.day}**  ·  This week: **${total.week}**  ·  Total: **${total.total}** (${files} files)`, last ? `Last: <t:${Math.floor(new Date(last.created_at).getTime() / 1000)}:R> in <#${last.channel_id}>` : 'No uploads yet.'].join('\n'))],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function leaderboard(interaction) {
  const word = (interaction.options.getString('period') ?? 'week').toLowerCase().replace(/[\s_-]/g, '');
  const period = PERIOD_WORDS[word];
  if (!period) return interaction.editReply({ components: [textCard('Choose `today`, `week` or `all`.')], flags: MessageFlags.IsComponentsV2 });
  const top = rank(asRows(await uploadsDb.listLog(interaction.guild.id, { since: periodStart(period) }))).slice(0, 10);
  const lines = top.length ? top.map((entry, index) => `${index + 1}. <@${entry.managerId}>  **${entry.count}**`) : ['Nobody has uploaded in this period.'];
  return interaction.editReply({ components: [textCard([`### Upload leaderboard · ${PERIODS[period]}`, ...lines].join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
  prefixOnly: true,
  aliases: ['upload'],
  data: new SlashCommandBuilder()
    .setName('uploads')
    .setDescription('Uploads: your numbers and the ranking.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('stats').setDescription('The uploads of a member.').addUserOption((o) => o.setName('user').setDescription('Who (you by default)').setRequired(false)))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Who has the most uploads.').addStringOption((o) => o.setName('period').setDescription('today, week or all').setRequired(false))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const config = await uploadsDb.getConfig(interaction.guild.id);
    if (!config?.enabled) return interaction.editReply({ components: [textCard('Uploads are not turned on in this server. An admin can turn them on with `!uploadconfig enable`.')], flags: MessageFlags.IsComponentsV2 });
    return interaction.options.getSubcommand() === 'stats' ? stats(interaction) : leaderboard(interaction);
  },
};
