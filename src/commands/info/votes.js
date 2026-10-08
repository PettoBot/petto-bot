const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const votesDb = require('../../db/votes');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

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
    const reply = (text, color = 0x4b4f59) => interaction.reply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

    if (sub === 'top') {
      const rows = await votesDb.topVoters(10);
      if (!rows.length) return reply(`No votes yet. Be the first: ${voteUrl(interaction.client)}`);
      const lines = rows.map((row, index) => `**${index + 1}.** <@${row.user_id}> — ${row.total} vote${row.total === 1 ? '' : 's'}`);
      return reply(`### ${EMOJI.STAR} Top voters\n${lines.join('\n')}\n-# Vote at ${voteUrl(interaction.client)}`);
    }

    const target = interaction.options.getUser('user') ?? interaction.user;
    const totals = await votesDb.voteTotals(target.id);
    const last = totals.last ? `\nLast vote: <t:${Math.floor(new Date(totals.last).getTime() / 1000)}:R>` : '';
    return reply(`### ${EMOJI.STAR} Votes for Petto\n**${totals.total}** vote${totals.total === 1 ? '' : 's'} from **${totals.voters}** member${totals.voters === 1 ? '' : 's'} in total.\n<@${target.id}> has **${totals.mine}**.${last}\n-# Vote at ${voteUrl(interaction.client)}`);
  },
};
