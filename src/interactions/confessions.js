// The buttons of the confessions: "Confess" of the panel (opens the form), "Reply anonymously" under each confession, and the two of
// the staff to approve or reject one that waits.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const db = require('../db/confessions');
const confessions = require('../utils/confessions');
const logger = require('../utils/logger');

const PREFIX = confessions.BUTTON_PREFIX;
const V2 = MessageFlags.IsComponentsV2;

const say = (interaction, text, color = 0x4b4f59) => interaction.reply({
  components: [new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
  flags: V2 | MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});

/** The panel: a message with a button that opens the form, for servers that want confessions without a command. */
function buildPanel(guild, config) {
  const container = new ContainerBuilder().setAccentColor(config.color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Confessions\n${config.panel_text}`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:new`).setLabel(String(config.button_label || 'Confess').slice(0, 80)).setStyle(ButtonStyle.Success)));
  return { components: [container], flags: V2, allowedMentions: { parse: [] } };
}

function form(customId, title, config, withImage) {
  const rows = [new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('What do you want to say?').setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(confessions.MAX_CONTENT).setRequired(true))];
  if (withImage && config.allow_images) rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('A link to a picture (optional)').setStyle(TextInputStyle.Short).setMaxLength(400).setRequired(false)));
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(...rows);
}

async function handleButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (!interaction.guild) return;
  const config = await db.getConfig(interaction.guild.id);
  if (action === 'new') {
    if (!config.enabled) return say(interaction, 'Confessions are not turned on in this server.');
    return interaction.showModal(form(`${PREFIX}:form`, 'Your confession', config, true));
  }
  if (action === 'reply') {
    if (!config.enabled || !config.allow_replies) return say(interaction, 'Anonymous replies are not turned on in this server.');
    return interaction.showModal(form(`${PREFIX}:answer:${id}`, 'Your anonymous reply', config, false));
  }
  if (action === 'ok' || action === 'no') {
    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const result = await confessions.decide({ guild: interaction.guild, member, id, approve: action === 'ok' });
    if (result.error) return say(interaction, result.error, 0xff6b6b);
    const picture = /^attachment:\/\/([\w.-]+)$/.exec(result.row.image_url ?? '')?.[1] ?? null;
    const card = confessions.reviewCard(result.row, result.config, { status: action === 'ok' ? 'approved' : 'rejected', by: interaction.user.id, pictureName: picture });
    // The picture stays as the file of this message, so the edit keeps it.
    return interaction.update({ components: card.components, flags: card.flags, attachments: [...(interaction.message?.attachments?.values?.() ?? [])], allowedMentions: card.allowedMentions });
  }
}

async function handleModal(interaction) {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: V2 | MessageFlags.Ephemeral });
  const parts = interaction.customId.split(':');
  const text = interaction.fields.getTextInputValue('text');
  let result;
  if (parts[1] === 'answer') {
    result = await confessions.reply({ guild: interaction.guild, user: interaction.user, id: parts[2], text });
    if (result.error) return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xff6b6b).addTextDisplayComponents(new TextDisplayBuilder().setContent(result.error))], flags: V2 });
    return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xa5ea7a).addTextDisplayComponents(new TextDisplayBuilder().setContent(`Your reply was posted: ${result.thread}`))], flags: V2 });
  }
  let image = null;
  try { image = interaction.fields.getTextInputValue('image')?.trim() || null; } catch { image = null; }
  result = await confessions.submit({ guild: interaction.guild, user: interaction.user, text, imageUrl: image });
  const body = result.error ?? (result.review ? 'Your confession was sent to the staff. It shows up when they approve it.' : `Your confession was posted${result.message?.url ? `: ${result.message.url}` : '.'}`);
  return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(result.error ? 0xff6b6b : 0xa5ea7a).addTextDisplayComponents(new TextDisplayBuilder().setContent(body))], flags: V2 });
}

/** Posts the panel in a channel, or edits the one posted before there. Returns `{ ok, message }`. */
async function postPanel(guild, config, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || channel.isThread?.()) return { ok: false, message: 'Pick a text channel for the panel.' };
  if (!channel.permissionsFor(guild.members.me)?.has(['ViewChannel', 'SendMessages'])) return { ok: false, message: `I cannot write in #${channel.name}.` };
  const payload = buildPanel(guild, config);
  let message = null;
  if (config.panel_message_id && config.panel_channel_id === channel.id) {
    message = await channel.messages.fetch(config.panel_message_id).catch(() => null);
    if (message) await message.edit({ components: payload.components, flags: payload.flags }).catch(() => { message = null; });
  }
  if (!message) message = await channel.send(payload);
  await db.updateConfig(guild.id, { panel_channel_id: channel.id, panel_message_id: message.id });
  return { ok: true, message: `The panel is in #${channel.name}.` };
}

module.exports = { PREFIX, buildPanel, postPanel, handleButton: (i) => handleButton(i).catch((err) => logger.error('Confession button failed:', err)), handleModal: (i) => handleModal(i).catch((err) => logger.error('Confession form failed:', err)) };
