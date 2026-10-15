const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const votesDb = require('../../db/votes');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');

const voteUrl = (client) => `https://top.gg/bot/${client.user.id}/vote`;

module.exports = {
  prefixOnly: true,
  prefixDefaultSubcommand: 'show',
  aliases: ['vote'],
  data: new SlashCommandBuilder()
    .setName('votes')
    .setDescription('See the votes of Petto on top.gg: the total and yours.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('show').setDescription('The votes of Petto and yours (or of another member).').addUserOption((opt) => opt.setName('user').setDescription('Member to look at').setRequired(false)))
    .addSubcommand((sub) => sub.setName('top').setDescription('The members who voted the most.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    const reply = (text, color = 0x4b4f59) => interaction.reply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

    if (sub === 'top') {
      const rows = await votesDb.topVoters(10);
      if (!rows.length) return reply(t(lang, 'votes.none', { link: voteUrl(interaction.client) }));
      const lines = rows.map((row, index) => tn(lang, 'votes.top.line', row.total, { count: row.total, rank: index + 1, user: `<@${row.user_id}>` }));
      return reply([t(lang, 'votes.top.title', { emoji: EMOJI.STAR }), ...lines, t(lang, 'votes.voteAt', { link: voteUrl(interaction.client) })].join('\n'));
    }

    const target = interaction.options.getUser('user') ?? interaction.user;
    const totals = await votesDb.voteTotals(target.id);
    return reply([
      t(lang, 'votes.show.title', { emoji: EMOJI.STAR }),
      t(lang, 'votes.show.total', { votes: tn(lang, 'votes.show.votes', totals.total, { count: totals.total }), members: tn(lang, 'votes.show.members', totals.voters, { count: totals.voters }) }),
      t(lang, 'votes.show.mine', { user: `<@${target.id}>`, count: totals.mine }),
      totals.last ? t(lang, 'votes.show.last', { time: `<t:${Math.floor(new Date(totals.last).getTime() / 1000)}:R>` }) : '',
      t(lang, 'votes.voteAt', { link: voteUrl(interaction.client) }),
    ].filter(Boolean).join('\n'));
  },
};
