// The buttons of the confessions: "Confess" of the panel (opens the form), "Reply anonymously" under each confession, and the two of
// the staff to approve or reject one that waits.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, FileUploadBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
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

/**
 * The form of a confession: the text and, when the server allows pictures, a place to drop or attach the picture itself (the file upload of a form, one picture, optional).
 * A link to a picture written inside the text still works. The form of an anonymous reply has no picture.
 */
function form(customId, title, config, withImage, lang) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title).addLabelComponents(
    new LabelBuilder().setLabel(t(lang, 'confessions.form.text')).setTextInputComponent(new TextInputBuilder().setCustomId('text').setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(confessions.MAX_CONTENT).setRequired(true)),
  );
  if (withImage && config.allow_images) {
    modal.addLabelComponents(
      new LabelBuilder().setLabel(t(lang, 'confessions.form.image')).setDescription(t(lang, 'confessions.form.imageHint')).setFileUploadComponent(new FileUploadBuilder().setCustomId('image').setMinValues(0).setMaxValues(1).setRequired(false)),
    );
  }
  return modal;
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
  // The picture the person dropped in the form. (A form that was open before this change has a text box for a link there instead: it still works.)
  let attachments = [];
  try { attachments = [...(interaction.fields.getUploadedFiles('image', false)?.values() ?? [])]; } catch { attachments = []; }
  let image = null;
  if (!attachments.length) { try { image = interaction.fields.getTextInputValue('image')?.trim() || null; } catch { image = null; } }
  if (attachments.length && !attachments.some((file) => String(file?.contentType ?? '').startsWith('image/'))) {
    return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xff6b6b).addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'confessions.error.notImage')))], flags: V2 });
  }
  result = await confessions.submit({ guild: interaction.guild, user: interaction.user, text, attachments, imageUrl: image });
  const body = result.error ?? (result.review ? t(lang, 'confessions.sentToStaff') : result.message?.url ? t(lang, 'confessions.posted.link', { link: result.message.url }) : t(lang, 'confessions.posted.plain'));
  const note = !result.error && result.pictureLost ? `\n-# ${t(lang, 'confessions.pictureLost')}` : '';
  return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(result.error ? 0xff6b6b : 0xa5ea7a).addTextDisplayComponents(new TextDisplayBuilder().setContent(`${body}${note}`))], flags: V2 });
}

const { postPanel } = confessions;

module.exports = { PREFIX, buildPanel, postPanel, handleButton: (i) => handleButton(i).catch((err) => logger.error('Confession button failed:', err)), handleModal: (i) => handleModal(i).catch((err) => logger.error('Confession form failed:', err)) };
