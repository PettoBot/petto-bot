// The buttons of the confessions: "Confess" of the panel (opens the form), "Reply anonymously" under each confession, and the two of
// the staff to approve or reject one that waits.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const db = require('../db/confessions');
const confessions = require('../utils/confessions');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

const { semanticColor } = require('../utils/colors');
const PREFIX = confessions.BUTTON_PREFIX;
const V2 = MessageFlags.IsComponentsV2;

const say = (interaction, text, color = null) => interaction.reply({
  components: [new ContainerBuilder().setAccentColor(semanticColor(color)).addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
  flags: V2 | MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});

const { buildPanel } = confessions;

function form(customId, title, config, withImage, lang) {
  const rows = [new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel(t(lang, 'confessions.form.text')).setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(confessions.MAX_CONTENT).setRequired(true))];
  if (withImage && config.allow_images) rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel(t(lang, 'confessions.form.image')).setStyle(TextInputStyle.Short).setMaxLength(400).setRequired(false)));
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(...rows);
}

async function handleButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (!interaction.guild) return;
  const lang = await languageOf(interaction);
  const config = await db.getConfig(interaction.guild.id);
  if (action === 'new') {
    if (!config.enabled) return say(interaction, t(lang, 'confessions.error.off'));
    return interaction.showModal(form(`${PREFIX}:form`, t(lang, 'confessions.form.title'), config, true, lang));
  }
  if (action === 'reply') {
    if (!config.enabled || !config.allow_replies) return say(interaction, t(lang, 'confessions.error.repliesOff'));
    return interaction.showModal(form(`${PREFIX}:answer:${id}`, t(lang, 'confessions.form.replyTitle'), config, false, lang));
  }
  if (action === 'ok' || action === 'no') {
    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const result = await confessions.decide({ guild: interaction.guild, member, id, approve: action === 'ok' });
    if (result.error) return say(interaction, result.error, 0xff6b6b);
    const picture = /^attachment:\/\/([\w.-]+)$/.exec(result.row.image_url ?? '')?.[1] ?? null;
    const card = confessions.reviewCard(result.row, result.config, { status: action === 'ok' ? 'approved' : 'rejected', by: interaction.user.id, pictureName: picture, lang });
    // The picture stays as the file of this message, so the edit keeps it.
    return interaction.update({ components: card.components, flags: card.flags, attachments: [...(interaction.message?.attachments?.values?.() ?? [])], allowedMentions: card.allowedMentions });
  }
}

async function handleModal(interaction) {
  if (!interaction.guild) return;
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: V2 | MessageFlags.Ephemeral });
  const parts = interaction.customId.split(':');
  const text = interaction.fields.getTextInputValue('text');
  let result;
  if (parts[1] === 'answer') {
    result = await confessions.reply({ guild: interaction.guild, user: interaction.user, id: parts[2], text });
    if (result.error) return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xff6b6b).addTextDisplayComponents(new TextDisplayBuilder().setContent(result.error))], flags: V2 });
    return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xa5ea7a).addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'confessions.replyPosted', { thread: `${result.thread}` })))], flags: V2 });
  }
  let image = null;
  try { image = interaction.fields.getTextInputValue('image')?.trim() || null; } catch { image = null; }
  result = await confessions.submit({ guild: interaction.guild, user: interaction.user, text, imageUrl: image });
  const body = result.error ?? (result.review ? t(lang, 'confessions.sentToStaff') : result.message?.url ? t(lang, 'confessions.posted.link', { link: result.message.url }) : t(lang, 'confessions.posted.plain'));
  return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(result.error ? 0xff6b6b : 0xa5ea7a).addTextDisplayComponents(new TextDisplayBuilder().setContent(body))], flags: V2 });
}

const { postPanel } = confessions;

module.exports = { PREFIX, buildPanel, postPanel, handleButton: (i) => handleButton(i).catch((err) => logger.error('Confession button failed:', err)), handleModal: (i) => handleModal(i).catch((err) => logger.error('Confession form failed:', err)) };
