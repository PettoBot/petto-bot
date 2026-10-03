// Partner numbers for everyone: how many partnerships a Partner Manager has, and the ranking. The settings are in `/partnerconfig`.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const partnersDb = require('../../db/partners');
const { periodStart, rank, counts } = require('../../utils/partnerEngine');
const { textCard } = require('../../utils/caseCard');

const PERIODS = { day: 'Today', week: 'This week', all: 'All time' };

module.exports = {
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
    const config = await partnersDb.getConfig(interaction.guild.id);
    if (!config?.enabled) {
      return interaction.editReply({ components: [textCard('Partners are not turned on in this server. An admin can turn them on with `/partnerconfig enable`.')], flags: MessageFlags.IsComponentsV2 });
    }
    if (interaction.options.getSubcommand() === 'stats') return stats(interaction);
    return leaderboard(interaction);
  },
};

async function stats(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const rows = await partnersDb.listLog(interaction.guild.id, { managerId: user.id });
  const total = counts(rows);
  const last = rows[0];
  const lines = [
    `### Partnerships of ${user.username}`,
    `Today: **${total.day}**  ·  This week: **${total.week}**  ·  Total: **${total.total}**`,
    last ? `Last: **${last.partner_name ?? 'a server'}** <t:${Math.floor(new Date(last.created_at).getTime() / 1000)}:R>` : 'No partnerships yet.',
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

async function leaderboard(interaction) {
  const period = interaction.options.getString('period') ?? 'week';
  const rows = await partnersDb.listLog(interaction.guild.id, { since: periodStart(period) });
  const top = rank(rows).slice(0, 10);
  const lines = top.length ? top.map((entry, index) => `${index + 1}. <@${entry.managerId}>  **${entry.count}**`) : ['Nobody has a partnership in this period.'];
  await interaction.editReply({ components: [textCard([`### Partner leaderboard · ${PERIODS[period]}`, ...lines].join('\n'))], flags: MessageFlags.IsComponentsV2 });
}
