// `/support` (and `!support`): the invitation to Petto's support server, for anyone who needs a hand, wants to report a bug or follow the news.
const {
  SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { EMOJI } = require('../../utils/emojis');
const { SUPPORT_URL } = require('../../utils/links');
const { t, languageOf } = require('../../i18n');

/** The card: what the support server is for, and the button that opens its invitation. */
function buildSupportCard(lang) {
  return {
    components: [new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        t(lang, 'info.support.title', { emoji: EMOJI.BOT }),
        t(lang, 'info.support.text', { emoji: EMOJI.INFO }),
      ].join('\n')))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(t(lang, 'core.join.support.button')).setEmoji({ name: 'petto', id: '1542559402983428368' }).setStyle(ButtonStyle.Link).setURL(SUPPORT_URL),
      ))],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = {
  aliases: ['invitesupport', 'supportserver'],
  registerSlash: true,
  guildScoped: true, // the 100 global slots are kept free: it is registered in each server instead (second set)
  buildSupportCard,
  data: new SlashCommandBuilder().setName('support').setDescription("Gives you the invitation to Petto's support server.").setDMPermission(false),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.reply(buildSupportCard(lang));
  },
};
