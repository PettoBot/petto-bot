// Everyone can appear in the user ranking of the public stats page; this lets a member hide themselves or come back.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const globalStatsDb = require('../../db/globalStats');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

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
    // It also answers in DMs, where there is no server: then it follows the member's Discord language.
    const lang = await languageOf(interaction);
    const reply = (text) => interaction.editReply({ components: [textCard(text, null)], flags: MessageFlags.IsComponentsV2 });
    const sub = interaction.options.getSubcommand();
    if (sub === 'on') {
      await globalStatsDb.setUserVisible(interaction.user.id, true);
      return reply(t(lang, 'leveling.globalRanking.on', { emoji: EMOJI.APPROVE }));
    }
    if (sub === 'off') {
      await globalStatsDb.setUserVisible(interaction.user.id, false);
      return reply(t(lang, 'leveling.globalRanking.off', { emoji: EMOJI.APPROVE }));
    }
    const visible = await globalStatsDb.isUserVisible(interaction.user.id);
    return reply(t(lang, visible ? 'leveling.globalRanking.visible' : 'leveling.globalRanking.hidden'));
  },
};
