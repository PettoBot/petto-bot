// Everyone can appear in the user ranking of the public stats page; this lets a member hide themselves or come back.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const globalStatsDb = require('../../db/globalStats');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  prefixOnly: true,
  aliases: ['globalrank', 'publicranking'],
  prefixDefaultSubcommand: 'status',
  data: new SlashCommandBuilder()
    .setName('globalranking')
    .setDescription('Hide yourself from the user ranking of the public stats page, or show up again.')
    .addSubcommand((s) => s.setName('on').setDescription('Show your name and avatar in the ranking again.'))
    .addSubcommand((s) => s.setName('off').setDescription('Hide yourself from the ranking.'))
    .addSubcommand((s) => s.setName('status').setDescription('See if you are in the ranking.')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const reply = (text) => interaction.editReply({ components: [textCard(text, null)], flags: MessageFlags.IsComponentsV2 });
    const sub = interaction.options.getSubcommand();
    if (sub === 'on') {
      await globalStatsDb.setUserVisible(interaction.user.id, true);
      return reply(`${EMOJI.APPROVE}  You can now appear in the user ranking of Petto's public stats page, with your name, avatar and the messages and voice time you have in every server. \`globalranking off\` takes you out.`);
    }
    if (sub === 'off') {
      await globalStatsDb.setUserVisible(interaction.user.id, false);
      return reply(`${EMOJI.APPROVE}  You are hidden from the user ranking. It can take some minutes to disappear from the page.`);
    }
    const visible = await globalStatsDb.isUserVisible(interaction.user.id);
    return reply(visible ? 'You can appear in the user ranking of the public stats page, with your name, avatar and your messages and voice time in every server. `globalranking off` hides you.' : 'You are hidden from the user ranking of the public stats page. `globalranking on` shows you again.');
  },
};
