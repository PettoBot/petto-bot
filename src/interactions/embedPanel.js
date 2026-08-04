const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { getTemplate, upsertTemplate } = require('../db/embedTemplates');
const { parseColor, buildRawPreview, hasContent } = require('../utils/embedBuilder');
const { EMOJI } = require('../utils/emojis');

function placeholderEmbed(embedName) {
  return new EmbedBuilder()
    .setColor(0x4b4f59)
    .setDescription(`${EMOJI.STAR} **Embed \`${embedName}\` created.**\nUse the buttons below to fill in your embed fields.`);
}

function buildRows(sid, data) {
  const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(`${id}::${sid}`).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
  };

  const tsLabel = data?.timestamp ? 'Timestamp ✓' : 'Timestamp';

  return [
    new ActionRowBuilder().addComponents(btn('eb_title', 'Title'), btn('eb_description', 'Description'), btn('eb_color', 'Color'), btn('eb_author', 'Author'), btn('eb_footer', 'Footer')),
    new ActionRowBuilder().addComponents(btn('eb_thumbnail', 'Thumbnail'), btn('eb_image', 'Image'), btn('eb_timestamp', tsLabel, ButtonStyle.Secondary, data?.timestamp ? EMOJI.APPROVE : undefined), btn('eb_addfield', 'Add Field')),
    new ActionRowBuilder().addComponents(
      btn('eb_save', 'Save', ButtonStyle.Success, EMOJI.APPROVE),
      btn('eb_reset', 'Reset', ButtonStyle.Danger, EMOJI.ALERT),
      btn('eb_cancel', 'Cancel', ButtonStyle.Secondary, EMOJI.DENY),
    ),
  ];
}

/** Renders the panel message: a live (non-variable-resolved) preview + edit buttons. */
async function renderPanel(doc, embedName, userId) {
  const data = doc?.data ?? {};
  const sid = `${userId}::${embedName}`;

  const content = `${EMOJI.STAR} Editing \`${embedName}\`. Click a button to edit that field, or use \`/embed preview\` to see it with variables resolved.`;

  let embed;
  if (hasContent(data)) {
    try {
      embed = buildRawPreview(data);
    } catch {
      embed = placeholderEmbed(embedName);
    }
  } else {
    embed = placeholderEmbed(embedName);
  }

  return { content, embeds: [embed], components: buildRows(sid, data) };
}

async function handleButton(interaction) {
  const [type, userId, embedName] = interaction.customId.split('::');
  const guildId = interaction.guild.id;

  if (interaction.user.id !== userId) {
    await interaction.reply({ content: `${EMOJI.DENY} This panel belongs to someone else.`, flags: MessageFlags.Ephemeral });
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
    await interaction.editReply(await renderPanel(updated, embedName, userId));
    return;
  }

  if (type === 'eb_reset') {
    await interaction.deferUpdate();
    await upsertTemplate(guildId, embedName, { fields: [] });
    const updated = await getTemplate(guildId, embedName);
    await interaction.editReply(await renderPanel(updated, embedName, userId));
    return;
  }

  if (type === 'eb_save') {
    await interaction.deferUpdate();
    const updated = await getTemplate(guildId, embedName);
    const panel = await renderPanel(updated, embedName, userId);
    await interaction.editReply({ ...panel, components: [] });
    return;
  }

  if (type === 'eb_cancel') {
    await interaction.deferUpdate();
    await interaction.editReply({ components: [] });
    return;
  }

  // ── Modal-based actions ───────────────────────────────────────────────────
  const colorHex = data.color != null ? `#${data.color.toString(16).padStart(6, '0')}` : '';

  const modals = {
    eb_title: new ModalBuilder()
      .setCustomId(`em_title::${sid}`)
      .setTitle('Edit Title')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title (supports variables)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(data.title ?? '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel('Title URL (optional, must be https://)').setStyle(TextInputStyle.Short).setRequired(false).setValue(data.url ?? '')),
      ),

    eb_description: new ModalBuilder()
      .setCustomId(`em_description::${sid}`)
      .setTitle('Edit Description')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description (supports variables)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000).setValue(data.description ?? ''))),

    eb_color: new ModalBuilder()
      .setCustomId(`em_color::${sid}`)
      .setTitle('Edit Color')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Hex color (e.g. #ff91c2)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7).setValue(colorHex))),

    eb_author: new ModalBuilder()
      .setCustomId(`em_author::${sid}`)
      .setTitle('Edit Author')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Author name (supports variables)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(data.author?.name ?? '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('icon').setLabel('Icon URL ({user_avatar} or {server_icon})').setStyle(TextInputStyle.Short).setRequired(false).setValue(data.author?.icon ?? '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel('Author URL (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(data.author?.url ?? '')),
      ),

    eb_footer: new ModalBuilder()
      .setCustomId(`em_footer::${sid}`)
      .setTitle('Edit Footer')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Footer text (supports variables)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048).setValue(data.footer?.text ?? '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('icon').setLabel('Icon URL (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(data.footer?.icon ?? '')),
      ),

    eb_thumbnail: new ModalBuilder()
      .setCustomId(`em_thumbnail::${sid}`)
      .setTitle('Edit Thumbnail')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('thumbnail').setLabel('Thumbnail URL (small image, top-right)').setStyle(TextInputStyle.Short).setRequired(false).setValue(data.thumbnail ?? ''))),

    eb_image: new ModalBuilder()
      .setCustomId(`em_image::${sid}`)
      .setTitle('Edit Image')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image URL (large image, bottom)').setStyle(TextInputStyle.Short).setRequired(false).setValue(data.image ?? ''))),

    eb_addfield: new ModalBuilder()
      .setCustomId(`em_addfield::${sid}`)
      .setTitle('Add Field')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Field name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Field value').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1024)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inline').setLabel('Inline? (yes / no)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3).setValue('no')),
      ),
  };

  const modal = modals[type];
  if (!modal) return;
  await interaction.showModal(modal);
}

async function handleModal(interaction) {
  const [type, userId, embedName] = interaction.customId.split('::');
  const guildId = interaction.guild.id;

  await interaction.deferUpdate();

  const doc = await getTemplate(guildId, embedName);
  if (!doc) {
    await interaction.followUp({ content: `${EMOJI.DENY} Embed \`${embedName}\` not found.`, flags: MessageFlags.Ephemeral });
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
      data.color = color ? parseColor(color) : null;
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
        await interaction.followUp({ content: `${EMOJI.DENY} Embeds can have at most 25 fields.`, flags: MessageFlags.Ephemeral });
        return;
      }
      data.fields.push({ name: g('name'), value: g('value'), inline: g('inline').toLowerCase() === 'yes' });
    }

    await upsertTemplate(guildId, embedName, data);
    const updated = await getTemplate(guildId, embedName);
    await interaction.editReply(await renderPanel(updated, embedName, userId));
  } catch (err) {
    await interaction.followUp({ content: `${EMOJI.DENY} Error: ${err.message}`, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { renderPanel, handleButton, handleModal };
