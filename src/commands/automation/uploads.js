// Upload numbers for everyone: how many uploads a member has, and the ranking. The settings are in `!uploadconfig`.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const uploadsDb = require('../../db/uploads');
const { periodStart, rank, counts } = require('../../utils/partnerEngine');
const { textCard } = require('../../utils/caseCard');
const { t, tn, languageOf } = require('../../i18n');

const PERIOD_WORDS = { day: 'day', today: 'day', daily: 'day', week: 'week', weekly: 'week', all: 'all', total: 'all', alltime: 'all' };
// The numbers use the same day, week and ranking rules as partners, which read `manager_id`.
const asRows = (rows) => rows.map((row) => ({ ...row, manager_id: row.user_id }));

async function stats(interaction, lang) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const rows = await uploadsDb.listLog(interaction.guild.id, { userId: user.id });
  const total = counts(asRows(rows));
  const files = rows.reduce((sum, row) => sum + (row.files ?? 1), 0);
  const last = rows[0];
  const lines = [
    t(lang, 'uploads.stats.title', { user: user.username }),
    tn(lang, 'uploads.stats.counts', files, { day: total.day, week: total.week, total: total.total, count: files }),
    last ? t(lang, 'uploads.stats.last', { time: `<t:${Math.floor(new Date(last.created_at).getTime() / 1000)}:R>`, channel: `<#${last.channel_id}>` }) : t(lang, 'uploads.stats.none'),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

async function leaderboard(interaction, lang) {
  const word = (interaction.options.getString('period') ?? 'week').toLowerCase().replace(/[\s_-]/g, '');
  const period = PERIOD_WORDS[word];
  if (!period) return interaction.editReply({ components: [textCard(t(lang, 'uploads.leaderboard.choose'))], flags: MessageFlags.IsComponentsV2 });
  const top = rank(asRows(await uploadsDb.listLog(interaction.guild.id, { since: periodStart(period) }))).slice(0, 10);
  const lines = top.length ? top.map((entry, index) => `${index + 1}. <@${entry.managerId}>  **${entry.count}**`) : [t(lang, 'uploads.leaderboard.empty')];
  return interaction.editReply({ components: [textCard([t(lang, 'uploads.leaderboard.title', { period: t(lang, `uploads.period.${period}`) }), ...lines].join('\n'))], flags: MessageFlags.IsComponentsV2 });
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
    const lang = await languageOf(interaction);
    const config = await uploadsDb.getConfig(interaction.guild.id);
    if (!config?.enabled) return interaction.editReply({ components: [textCard(t(lang, 'uploads.off'))], flags: MessageFlags.IsComponentsV2 });
    return interaction.options.getSubcommand() === 'stats' ? stats(interaction, lang) : leaderboard(interaction, lang);
  },
};
