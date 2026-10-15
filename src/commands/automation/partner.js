// Partner numbers for everyone: how many partnerships a Partner Manager has, and the ranking. The settings are in `!partnerconfig`.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const partnersDb = require('../../db/partners');
const { periodStart, rank, counts } = require('../../utils/partnerEngine');
const { textCard } = require('../../utils/caseCard');
const { t, languageOf } = require('../../i18n');

// With the prefix (`!partner leaderboard today`) the choices are not checked by Discord, so the usual words are read here.
const PERIOD_WORDS = { day: 'day', today: 'day', daily: 'day', week: 'week', weekly: 'week', all: 'all', total: 'all', alltime: 'all' };

module.exports = {
  prefixOnly: true,
  aliases: ['partners', 'pm'],
  data: new SlashCommandBuilder()
    .setName('partner')
    .setDescription('Partnerships: your numbers and the ranking.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('stats').setDescription('The partnerships of a Partner Manager.')
      .addUserOption((o) => o.setName('user').setDescription('Who (you by default)').setRequired(false)))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Who has the most partnerships.')
      .addStringOption((o) => o.setName('period').setDescription('Today, this week or all time').setRequired(false).addChoices({ name: 'today', value: 'day' }, { name: 'this week', value: 'week' }, { name: 'all time', value: 'all' }))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const lang = await languageOf(interaction);
    const config = await partnersDb.getConfig(interaction.guild.id);
    if (!config?.enabled) {
      return interaction.editReply({ components: [textCard(t(lang, 'partners.off'))], flags: MessageFlags.IsComponentsV2 });
    }
    if (interaction.options.getSubcommand() === 'stats') return stats(interaction, lang);
    return leaderboard(interaction, lang);
  },
};

async function stats(interaction, lang) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const rows = await partnersDb.listLog(interaction.guild.id, { managerId: user.id });
  const total = counts(rows);
  const last = rows[0];
  const lines = [
    t(lang, 'partners.stats.title', { user: user.username }),
    t(lang, 'partners.stats.counts', { day: total.day, week: total.week, total: total.total }),
    last ? t(lang, 'partners.stats.last', { name: last.partner_name ?? t(lang, 'partners.stats.aServer'), time: `<t:${Math.floor(new Date(last.created_at).getTime() / 1000)}:R>` }) : t(lang, 'partners.stats.none'),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

async function leaderboard(interaction, lang) {
  const word = (interaction.options.getString('period') ?? 'week').toLowerCase().replace(/[\s_-]/g, '');
  const period = PERIOD_WORDS[word];
  if (!period) return interaction.editReply({ components: [textCard(t(lang, 'partners.leaderboard.choose'))], flags: MessageFlags.IsComponentsV2 });
  const rows = await partnersDb.listLog(interaction.guild.id, { since: periodStart(period) });
  const top = rank(rows).slice(0, 10);
  const lines = top.length ? top.map((entry, index) => `${index + 1}. <@${entry.managerId}>  **${entry.count}**`) : [t(lang, 'partners.leaderboard.empty')];
  await interaction.editReply({ components: [textCard([t(lang, 'partners.leaderboard.title', { period: t(lang, `partners.period.${period}`) }), ...lines].join('\n'))], flags: MessageFlags.IsComponentsV2 });
}
