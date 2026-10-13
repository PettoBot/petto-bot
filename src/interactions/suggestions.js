// The buttons of the suggestions: the two votes under each one, and the "Suggest" button of the panel with its form.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const db = require('../db/suggestions');
const suggestions = require('../utils/suggestions');
const logger = require('../utils/logger');

const PREFIX = suggestions.BUTTON_PREFIX;
const V2 = MessageFlags.IsComponentsV2;

const say = (interaction, text) => interaction.reply({
  components: [new ContainerBuilder().setAccentColor(0x4b4f59).addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
  flags: V2 | MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});

/** The panel: a message with a button that opens the form, for servers that want suggestions without a command. */
function buildPanel(guild, config) {
  const container = new ContainerBuilder().setAccentColor(config.color_pending)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Suggestions\nHave an idea for **${guild.name}**? Press the button, write it and the server votes on it${config.channel_id ? ` in <#${config.channel_id}>` : ''}.`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:new`).setLabel('Make a suggestion').setStyle(ButtonStyle.Primary)));
  return { components: [container], flags: V2, allowedMentions: { parse: [] } };
}

async function handleButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (!interaction.guild) return;
  if (action === 'new') {
    const config = await db.getConfig(interaction.guild.id);
    if (!config.enabled) return say(interaction, 'Suggestions are not turned on in this server.');
    return interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:form`).setTitle('Your suggestion').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('What is your suggestion?').setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(suggestions.MAX_CONTENT).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('A link to a picture (optional)').setStyle(TextInputStyle.Short).setMaxLength(400).setRequired(false)),
    ));
  }
  if (action !== 'up' && action !== 'down') return;
  const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const result = await suggestions.vote({ guild: interaction.guild, member, id, direction: action });
  if (result.error) return say(interaction, result.error);
  // The button answers by changing the message it is on, so what people see is always what is counted.
  const tally = await db.tally(id, interaction.user.id);
  const payload = await suggestions.render(interaction.guild, result.row, result.config, { tally });
  return interaction.update({ components: payload.components, embeds: payload.embeds, files: payload.files, attachments: [...(interaction.message?.attachments?.values?.() ?? [])], content: payload.content ?? null, flags: payload.flags, allowedMentions: { parse: [] } });
}

async function handleModal(interaction) {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const text = interaction.fields.getTextInputValue('text');
  const image = interaction.fields.getTextInputValue('image')?.trim();
  const result = await suggestions.submit({ guild: interaction.guild, user: interaction.user, text: image ? `${text}\n${image}` : text });
  if (result.error) return interaction.editReply({ content: result.error });
  return interaction.editReply({ content: `Your suggestion was posted${result.message?.url ? `: ${result.message.url}` : '.'}` });
}

module.exports = { PREFIX, buildPanel, handleButton: (i) => handleButton(i).catch((err) => logger.error('Suggestion button failed:', err)), handleModal: (i) => handleModal(i).catch((err) => logger.error('Suggestion form failed:', err)) };
