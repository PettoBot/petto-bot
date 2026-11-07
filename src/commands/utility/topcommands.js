const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } = require('discord.js');
const { buildBoard } = require('../../utils/commandUsage');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, formatNumber, languageOf } = require('../../i18n');

const PER_PAGE = 10;
const TIMEOUT_MS = 120_000;

function navRow(page, totalPages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('topcmds_prev').setEmoji(EMOJI.PREV).setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 1),
    new ButtonBuilder().setCustomId('topcmds_next').setEmoji(EMOJI.NEXT).setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === totalPages),
    new ButtonBuilder().setCustomId('topcmds_close').setEmoji(EMOJI.CLOSE).setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

/** One page of the ranking as a card: the title, ten lines, the page it is on, and the buttons. */
function buildPage({ board, page, lang, disabled = false }) {
  const totalPages = Math.max(1, Math.ceil(board.length / PER_PAGE));
  const offset = (page - 1) * PER_PAGE;
  const lines = board.slice(offset, offset + PER_PAGE).map((entry, i) => t(lang, 'utility.topcommands.line', { position: offset + i + 1, name: entry.name, uses: formatNumber(lang, entry.uses) }));
  const card = new ContainerBuilder();
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${t(lang, 'utility.topcommands.title')}\n${lines.join('\n')}`));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${tn(lang, 'utility.topcommands.footer', board.length, { page, pages: totalPages })}`));
  if (totalPages > 1) {
    card.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    card.addActionRowComponents(navRow(page, totalPages, disabled));
  }
  return { card, totalPages };
}

module.exports = {
  // A prefix command: its slash entry is inside `/bot` (`/bot topcommands`, utils/umbrella.js).
  aliases: ['topcmds'],
  data: new SlashCommandBuilder()
    .setName('topcommands')
    .setDescription('The commands of Petto that are used the most.')
    .setDMPermission(false)
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setRequired(false).setMinValue(1)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const board = await buildBoard(interaction.client);
    if (!board.length) {
      await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'utility.topcommands.none')))], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const totalPages = Math.max(1, Math.ceil(board.length / PER_PAGE));
    let page = Math.min(Math.max(1, interaction.options.getInteger('page') ?? 1), totalPages);
    const msg = await interaction.editReply({ components: [buildPage({ board, page, lang }).card], flags: MessageFlags.IsComponentsV2 });
    if (totalPages === 1) return;

    const collector = msg.createMessageComponentCollector({ time: TIMEOUT_MS });
    collector.on('collect', async (i) => {
      // Somebody else pressing a button is told whose they are (a button that does nothing looks broken).
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: t(lang, 'utility.topcommands.notYours', { prefix: interaction.typedPrefix ?? '/' }), flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (i.customId === 'topcmds_close') {
        collector.stop('closed');
        await i.update({ components: [buildPage({ board, page, lang, disabled: true }).card], flags: MessageFlags.IsComponentsV2 });
        return;
      }
      if (i.customId === 'topcmds_prev') page = Math.max(1, page - 1);
      if (i.customId === 'topcmds_next') page = Math.min(totalPages, page + 1);
      await i.update({ components: [buildPage({ board, page, lang }).card], flags: MessageFlags.IsComponentsV2 });
    });
    collector.on('end', (_collected, reason) => {
      if (reason === 'closed') return;
      msg.edit({ components: [buildPage({ board, page, lang, disabled: true }).card], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });
  },
};

module.exports.buildPage = buildPage;
