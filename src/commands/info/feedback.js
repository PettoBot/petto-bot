const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const config = require('../../config');
const { EMOJI } = require('../../feedback/card');
const { t, languageOf } = require('../../i18n');

const mention = (emoji) => `<:${emoji.name}:${emoji.id}>`;

/** The (private) answer of the command: where the board is and how its buttons work. */
function buildFeedbackAnswer(lang, site = config.siteUrl) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${t(lang, 'feedback.command.title')}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      t(lang, 'feedback.command.share', { url: `${site}/feedback` }),
      t(lang, 'feedback.command.buttons', { like: mention(EMOJI.like), dislike: mention(EMOJI.dislike) }),
    ].join('\n')));
  const links = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'feedback.command.board')).setURL(`${site}/feedback`),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'feedback.command.write')).setURL(`${site}/feedback/new`),
  );
  return { components: [container, links], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

module.exports = {
  registerSlash: true,
  data: new SlashCommandBuilder().setName('feedback').setDescription('Open the feedback board, and see how to send an idea or vote.').setDMPermission(false),
  buildFeedbackAnswer,

  async execute(interaction) {
    await interaction.reply(buildFeedbackAnswer(await languageOf(interaction)));
  },
};
