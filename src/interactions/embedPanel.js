// Handles the interactive embed editor buttons and modals.
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { getTemplate, upsertTemplate } = require('../db/embedTemplates');
const { parseColor, buildRawPreview, hasContent } = require('../utils/embedBuilder');
const { EMOJI } = require('../utils/emojis');
const { t, languageOf, currentLanguage } = require('../i18n');

function placeholderEmbed(embedName, lang) {
  return new EmbedBuilder()
    .setColor(0x4b4f59)
    .setDescription(t(lang, 'embeds.panel.created', { emoji: EMOJI.STAR, name: embedName }));
}

function buildRows(sid, data, lang) {
  const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(`${id}::${sid}`).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
  };

  const tsLabel = t(lang, data?.timestamp ? 'embeds.panel.timestampOn.button' : 'embeds.panel.timestamp.button');

  return [
    new ActionRowBuilder().addComponents(btn('eb_title', t(lang, 'embeds.panel.title.button')), btn('eb_description', t(lang, 'embeds.panel.description.button')), btn('eb_color', t(lang, 'embeds.panel.color.button')), btn('eb_author', t(lang, 'embeds.panel.author.button')), btn('eb_footer', t(lang, 'embeds.panel.footer.button'))),
    new ActionRowBuilder().addComponents(btn('eb_thumbnail', t(lang, 'embeds.panel.thumbnail.button')), btn('eb_image', t(lang, 'embeds.panel.image.button')), btn('eb_timestamp', tsLabel, ButtonStyle.Secondary, data?.timestamp ? EMOJI.APPROVE : undefined), btn('eb_addfield', t(lang, 'embeds.panel.addField.button'))),
    new ActionRowBuilder().addComponents(
      btn('eb_save', t(lang, 'embeds.panel.save.button'), ButtonStyle.Success, EMOJI.APPROVE),
      btn('eb_reset', t(lang, 'embeds.panel.reset.button'), ButtonStyle.Danger, EMOJI.ALERT),
      btn('eb_cancel', t(lang, 'embeds.panel.cancel.button'), ButtonStyle.Secondary, EMOJI.DENY),
    ),
  ];
}

/**
 * The way the panel's first message named the preview command, so a re-render from a button keeps it (`!embed preview` or `/embed preview`).
 * The message can be in English, Spanish or Portuguese (embeds.panel.editing), so the words around the command are each language's.
 */
function previewRefFrom(interaction) {
  const match = /(?:use|usa) `([^`]+)` (?:to see|para v)/.exec(interaction?.message?.content ?? '');
  return match ? match[1] : '/embed preview'; // i18n-ignore: a command, not text
}

/** Renders the panel message: a live (non-variable-resolved) preview + edit buttons. */
async function renderPanel(doc, embedName, userId, previewRef = '/embed preview', lang = currentLanguage()) { // i18n-ignore: the default is a command
  const data = doc?.data ?? {};
  const sid = `${userId}::${embedName}`;

  const content = t(lang, 'embeds.panel.editing', { emoji: EMOJI.STAR, name: embedName, command: previewRef });

  let embed;
  if (hasContent(data)) {
    try {
      embed = buildRawPreview(data);
    } catch {
      embed = placeholderEmbed(embedName, lang);
    }
  } else {
    embed = placeholderEmbed(embedName, lang);
  }

  return { content, embeds: [embed], components: buildRows(sid, data, lang) };
}

async function handleButton(interaction) {
  const [type, userId, embedName] = interaction.customId.split('::');
  const guildId = interaction.guild.id;
  const lang = await languageOf(interaction);

  if (interaction.user.id !== userId) {
    await interaction.reply({ content: t(lang, 'embeds.panel.notYours', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral });
    return;
  }

  const doc = await getTemplate(guildId, embedName);
  const data = doc?.data ?? {};
  const sid = `${userId}::${embedName}`;

  if (type === 'eb_timestamp') {
    await interaction.deferUpdate();
    data.timestamp = !data.timestamp;
    await upsertTemplate(guildId, embedName, data);
    const updated = await getTemplate(guildId, embedName);
    await interaction.editReply(await renderPanel(updated, embedName, userId, previewRefFrom(interaction), lang));
    return;
  }

  if (type === 'eb_reset') {
    await interaction.deferUpdate();
    await upsertTemplate(guildId, embedName, { fields: [] });
    const updated = await getTemplate(guildId, embedName);
    await interaction.editReply(await renderPanel(updated, embedName, userId, previewRefFrom(interaction), lang));
    return;
  }

  if (type === 'eb_save') {
    await interaction.deferUpdate();
    const updated = await getTemplate(guildId, embedName);
    const panel = await renderPanel(updated, embedName, userId, previewRefFrom(interaction), lang);
    await interaction.editReply({ ...panel, components: [] });
    return;
  }

  if (type === 'eb_cancel') {
    await interaction.deferUpdate();
    await interaction.editReply({ components: [] });
    return;
  }
  const colorHex = data.color != null ? `#${data.color.toString(16).padStart(6, '0')}` : '';

  const modals = {
    eb_title: new ModalBuilder()
      .setCustomId(`em_title::${sid}`)
      .setTitle(t(lang, 'embeds.panel.modal.title'))
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel(t(lang, 'embeds.panel.modal.titleText')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(data.title ?? '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel(t(lang, 'embeds.panel.modal.titleUrl')).setStyle(TextInputStyle.Short).setRequired(false).setValue(data.url ?? '')),
      ),

    eb_description: new ModalBuilder()
      .setCustomId(`em_description::${sid}`)
      .setTitle(t(lang, 'embeds.panel.modal.description'))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel(t(lang, 'embeds.panel.modal.descriptionText')).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000).setValue(data.description ?? ''))),

    eb_color: new ModalBuilder()
      .setCustomId(`em_color::${sid}`)
      .setTitle(t(lang, 'embeds.panel.modal.color'))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel(t(lang, 'embeds.panel.modal.colorHex')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7).setValue(colorHex))),

    eb_author: new ModalBuilder()
      .setCustomId(`em_author::${sid}`)
      .setTitle(t(lang, 'embeds.panel.modal.author'))
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel(t(lang, 'embeds.panel.modal.authorName')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(data.author?.name ?? '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('icon').setLabel(t(lang, 'embeds.panel.modal.authorIcon')).setStyle(TextInputStyle.Short).setRequired(false).setValue(data.author?.icon ?? '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel(t(lang, 'embeds.panel.modal.authorUrl')).setStyle(TextInputStyle.Short).setRequired(false).setValue(data.author?.url ?? '')),
      ),

    eb_footer: new ModalBuilder()
      .setCustomId(`em_footer::${sid}`)
      .setTitle(t(lang, 'embeds.panel.modal.footer'))
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel(t(lang, 'embeds.panel.modal.footerText')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048).setValue(data.footer?.text ?? '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('icon').setLabel(t(lang, 'embeds.panel.modal.footerIcon')).setStyle(TextInputStyle.Short).setRequired(false).setValue(data.footer?.icon ?? '')),
      ),

    eb_thumbnail: new ModalBuilder()
      .setCustomId(`em_thumbnail::${sid}`)
      .setTitle(t(lang, 'embeds.panel.modal.thumbnail'))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('thumbnail').setLabel(t(lang, 'embeds.panel.modal.thumbnailUrl')).setStyle(TextInputStyle.Short).setRequired(false).setValue(data.thumbnail ?? ''))),

    eb_image: new ModalBuilder()
      .setCustomId(`em_image::${sid}`)
      .setTitle(t(lang, 'embeds.panel.modal.image'))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel(t(lang, 'embeds.panel.modal.imageUrl')).setStyle(TextInputStyle.Short).setRequired(false).setValue(data.image ?? ''))),

    eb_addfield: new ModalBuilder()
      .setCustomId(`em_addfield::${sid}`)
      .setTitle(t(lang, 'embeds.panel.modal.addField'))
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel(t(lang, 'embeds.panel.modal.fieldName')).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel(t(lang, 'embeds.panel.modal.fieldValue')).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1024)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inline').setLabel(t(lang, 'embeds.panel.modal.fieldInline')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3).setValue(t(lang, 'embeds.panel.modal.fieldInlineNo'))),
      ),
  };

  const modal = modals[type];
  if (!modal) return;
  await interaction.showModal(modal);
}

// What the "inline" box of a new field takes as yes, in each language (the box is short: at most 3 letters).
const INLINE_YES = new Set(['yes', 'sí', 'si', 'sim']);

async function handleModal(interaction) {
  const [type, userId, embedName] = interaction.customId.split('::');
  const guildId = interaction.guild.id;
  const lang = await languageOf(interaction);

  await interaction.deferUpdate();

  const doc = await getTemplate(guildId, embedName);
  if (!doc) {
    await interaction.followUp({ content: t(lang, 'embeds.panel.notFound', { emoji: EMOJI.DENY, name: embedName }), flags: MessageFlags.Ephemeral });
    return;
  }

  const data = { ...doc.data, fields: doc.data?.fields ?? [] };
  const g = (id) => interaction.fields.getTextInputValue(id).trim();

  try {
    if (type === 'em_title') {
      data.title = g('title') || null;
      data.url = g('url') || null;
    } else if (type === 'em_description') {
      data.description = g('description') || null;
    } else if (type === 'em_color') {
      const color = g('color');
      data.color = color ? parseColor(color, lang) : null;
    } else if (type === 'em_author') {
      const name = g('name');
      data.author = name ? { name, icon: g('icon') || null, url: g('url') || null } : null;
    } else if (type === 'em_footer') {
      const text = g('text');
      data.footer = text ? { text, icon: g('icon') || null } : null;
    } else if (type === 'em_thumbnail') {
      data.thumbnail = g('thumbnail') || null;
    } else if (type === 'em_image') {
      data.image = g('image') || null;
    } else if (type === 'em_addfield') {
      if (data.fields.length >= 25) {
        await interaction.followUp({ content: t(lang, 'embeds.panel.maxFields', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral });
        return;
      }
      data.fields.push({ name: g('name'), value: g('value'), inline: INLINE_YES.has(g('inline').toLowerCase()) });
    }

    await upsertTemplate(guildId, embedName, data);
    const updated = await getTemplate(guildId, embedName);
    await interaction.editReply(await renderPanel(updated, embedName, userId, previewRefFrom(interaction), lang));
  } catch (err) {
    await interaction.followUp({ content: t(lang, 'embeds.panel.error', { emoji: EMOJI.DENY, message: err.message }), flags: MessageFlags.Ephemeral });
  }
}

module.exports = { renderPanel, handleButton, handleModal };
