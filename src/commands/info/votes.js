const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const votesDb = require('../../db/votes');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf, formatList } = require('../../i18n');
const { voteLists } = require('../../utils/voteLists');
const { getVoteBoost, VOTE_BOOST_PERCENT, VOTE_BOOST_HOURS } = require('../../utils/voteBoost');

/** The vote links of every list as one line of text: `[top.gg](...) or [omniplex.gg](...)`. */
const voteLinks = (client, lang) => formatList(lang, voteLists(client.user.id).map((list) => `[${list.name}](${list.url})`), { word: 'or' });

module.exports = {
  prefixOnly: true,
  prefixDefaultSubcommand: 'show',
  aliases: ['vote'],
  data: new SlashCommandBuilder()
    .setName('votes')
    .setDescription('See the votes of Petto on top.gg and omniplex.gg: the total, yours and your vote boost.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('show').setDescription('The votes of Petto and yours (or of another member).').addUserOption((opt) => opt.setName('user').setDescription('Member to look at').setRequired(false)))
    .addSubcommand((sub) => sub.setName('top').setDescription('The members who voted the most.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    const reply = (text, color = 0x4b4f59) => interaction.reply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

    if (sub === 'top') {
      const rows = await votesDb.topVoters(10);
      if (!rows.length) return reply([t(lang, 'votes.none'), t(lang, 'votes.voteAt', { links: voteLinks(interaction.client, lang) })].join('\n'));
      const lines = rows.map((row, index) => tn(lang, 'votes.top.line', row.total, { count: row.total, rank: index + 1, user: `<@${row.user_id}>` }));
      return reply([t(lang, 'votes.top.title', { emoji: EMOJI.STAR }), ...lines, t(lang, 'votes.voteAt', { links: voteLinks(interaction.client, lang) })].join('\n'));
    }

    const target = interaction.options.getUser('user') ?? interaction.user;
    const [totals, boost] = await Promise.all([votesDb.voteTotals(target.id), getVoteBoost(target.id)]);
    const own = target.id === interaction.user.id;
    const boostVars = { percent: VOTE_BOOST_PERCENT, hours: VOTE_BOOST_HOURS };
    // The boost: active with the time it ends, or (for the member who asked) how to get it. The last line says the lists share one timer.
    const boostText = boost
      ? t(lang, own ? 'votes.boost.active' : 'votes.boost.activeOther', { ...boostVars, emoji: EMOJI.STAR, percent: boost.percent, time: `<t:${Math.floor(boost.endsAt / 1000)}:R>` })
      : t(lang, own ? 'votes.boost.inactive' : 'votes.boost.inactiveOther', boostVars);
    return reply([
      t(lang, 'votes.show.title', { emoji: EMOJI.STAR }),
      t(lang, 'votes.show.total', { votes: tn(lang, 'votes.show.votes', totals.total, { count: totals.total }), members: tn(lang, 'votes.show.members', totals.voters, { count: totals.voters }) }),
      t(lang, 'votes.show.mine', { user: `<@${target.id}>`, count: totals.mine }),
      totals.last ? t(lang, 'votes.show.last', { time: `<t:${Math.floor(new Date(totals.last).getTime() / 1000)}:R>` }) : '',
      boostText,
      t(lang, 'votes.voteAt', { links: voteLinks(interaction.client, lang) }),
      t(lang, 'votes.boost.note'),
    ].filter(Boolean).join('\n'));
  },
};
