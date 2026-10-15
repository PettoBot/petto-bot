// The buttons of the suggestions: the two votes under each one, and the "Suggest" button of the panel with its form.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const db = require('../db/suggestions');
const suggestions = require('../utils/suggestions');
const logger = require('../utils/logger');
const { t, languageOf, currentLanguage } = require('../i18n');

const PREFIX = suggestions.BUTTON_PREFIX;
const V2 = MessageFlags.IsComponentsV2;

const say = (interaction, text) => interaction.reply({
  components: [new ContainerBuilder().setAccentColor(0x4b4f59).addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
  flags: V2 | MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});

/** The panel: a message with a button that opens the form, for servers that want suggestions without a command. */
function buildPanel(guild, config, lang = currentLanguage()) {
  const text = config.channel_id ? t(lang, 'suggestions.panel.textIn', { server: guild.name, channel: `<#${config.channel_id}>` }) : t(lang, 'suggestions.panel.text', { server: guild.name });
  const container = new ContainerBuilder().setAccentColor(config.color_pending)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:new`).setLabel(t(lang, 'suggestions.panel.make.button')).setStyle(ButtonStyle.Primary)));
  return { components: [container], flags: V2, allowedMentions: { parse: [] } };
}

async function handleButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (!interaction.guild) return;
  const lang = await languageOf(interaction);
  if (action === 'new') {
    const config = await db.getConfig(interaction.guild.id);
    if (!config.enabled) return say(interaction, t(lang, 'suggestions.error.off'));
    return interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:form`).setTitle(t(lang, 'suggestions.form.title')).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel(t(lang, 'suggestions.form.text')).setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(suggestions.MAX_CONTENT).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel(t(lang, 'suggestions.form.image')).setStyle(TextInputStyle.Short).setMaxLength(400).setRequired(false)),
    ));
  }
  if (action !== 'up' && action !== 'down') return;
  const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const result = await suggestions.vote({ guild: interaction.guild, member, id, direction: action });
  if (result.error) return say(interaction, result.error);
  // The button answers by changing the message it is on, so what people see is always what is counted.
  const tally = await db.tally(id, interaction.user.id);
  const payload = await suggestions.render(interaction.guild, result.row, result.config, { tally, lang });
  return interaction.update({ components: payload.components, embeds: payload.embeds, files: payload.files, attachments: [...(interaction.message?.attachments?.values?.() ?? [])], content: payload.content ?? null, flags: payload.flags, allowedMentions: { parse: [] } });
}

async function handleModal(interaction) {
  if (!interaction.guild) return;
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const text = interaction.fields.getTextInputValue('text');
  const image = interaction.fields.getTextInputValue('image')?.trim();
  const result = await suggestions.submit({ guild: interaction.guild, user: interaction.user, text: image ? `${text}\n${image}` : text });
  if (result.error) return interaction.editReply({ content: result.error });
  return interaction.editReply({ content: result.message?.url ? t(lang, 'suggestions.posted.link', { link: result.message.url }) : t(lang, 'suggestions.posted.plain') });
}

module.exports = { PREFIX, buildPanel, handleButton: (i) => handleButton(i).catch((err) => logger.error('Suggestion button failed:', err)), handleModal: (i) => handleModal(i).catch((err) => logger.error('Suggestion form failed:', err)) };
