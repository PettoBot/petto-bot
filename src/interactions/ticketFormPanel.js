// Button-driven builder for reusable ticket forms, so no one has to type the field syntax.
const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const formsDb = require('../db/ticketForms');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');

const MAX_FIELDS = 5;
const DRAFT_TTL_MS = 15 * 60_000;
const drafts = new Map();

function setDraft(userId, data) {
  clearTimeout(drafts.get(userId)?.timer);
  const timer = setTimeout(() => drafts.delete(userId), DRAFT_TTL_MS);
  timer.unref?.();
  drafts.set(userId, { data, timer });
  return data;
}

function getDraft(userId) {
  return drafts.get(userId)?.data;
}

function deleteDraft(userId) {
  clearTimeout(drafts.get(userId)?.timer);
  drafts.delete(userId);
}

/** Starts a builder for a new form (mode "create") or an existing one (mode "edit"). */
function startDraft(userId, { guildId, mode, name, title = 'Ticket details', fields = [] }) {
  return setDraft(userId, { guildId, mode, name, title, fields: fields.map((f) => ({ ...f })) });
}

function renderPanel(uid, draft) {
  const lines = [
    `${EMOJI.STAR} ${draft.mode === 'edit' ? 'Editing' : 'Building'} the form \`${draft.name}\`. Add the questions members answer before a ticket opens, then **Save**.`,
    '',
    `### 📋 ${draft.title}`,
    '',
  ];
  if (draft.fields.length) {
    draft.fields.forEach((f, i) => {
      lines.push(`${i + 1}. **${f.label}**${f.required === false ? '' : ' *'}\n-# ${f.type === 'long_text' ? 'Paragraph' : 'Short answer'}${f.placeholder ? ` · hint: ${f.placeholder}` : ''}`);
    });
  } else {
    lines.push('*No questions yet — add at least 1.*');
  }
  lines.push('', `-# ${draft.fields.length}/${MAX_FIELDS} questions · * means required`);

  const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(`${id}::${uid}`).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
  };
  const full = draft.fields.length >= MAX_FIELDS;
  const rows = [
    new ActionRowBuilder().addComponents(
      btn('tf_add_short', 'Add short answer', ButtonStyle.Primary).setDisabled(full),
      btn('tf_add_long', 'Add paragraph', ButtonStyle.Primary).setDisabled(full),
      btn('tf_remove', 'Remove last').setDisabled(!draft.fields.length),
      btn('tf_title', 'Title'),
    ),
    new ActionRowBuilder().addComponents(
      btn('tf_save', 'Save', ButtonStyle.Success, EMOJI.APPROVE).setDisabled(!draft.fields.length),
      btn('tf_cancel', 'Cancel', ButtonStyle.Secondary, EMOJI.DENY),
    ),
  ];

  const container = new ContainerBuilder().setAccentColor(0x4b4f59).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return { components: [container, ...rows], flags: MessageFlags.IsComponentsV2 };
}

function ownerOnly(interaction, uid) {
  if (interaction.user.id !== uid) {
    interaction.reply({ content: `${EMOJI.DENY} This panel belongs to someone else.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    interaction.reply({ content: 'You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  return true;
}

async function expired(interaction) {
  await interaction.update({ components: [textCard('This form builder expired. Run the command again.', 0x8b8fa3)], flags: MessageFlags.IsComponentsV2 });
}

function fieldModal(uid, type) {
  const input = (id, label, style, required, max, placeholder) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
    if (placeholder) t.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(t);
  };
  return new ModalBuilder()
    .setCustomId(`tfm_${type}::${uid}`)
    .setTitle(type === 'long' ? 'Add a paragraph question' : 'Add a short question')
    .addComponents(
      input('label', 'Question', TextInputStyle.Short, true, 45, 'e.g. What happened?'),
      input('hint', 'Hint shown inside the box (optional)', TextInputStyle.Short, false, 100),
      input('required', 'Required? (yes or no)', TextInputStyle.Short, false, 3, 'yes'),
    );
}

async function handleButton(interaction) {
  const [type, uid] = interaction.customId.split('::');
  if (!ownerOnly(interaction, uid)) return;

  const draft = getDraft(uid);
  if (!draft) return expired(interaction);

  if (type === 'tf_add_short' || type === 'tf_add_long') {
    if (draft.fields.length >= MAX_FIELDS) {
      await interaction.reply({ content: `A form can have up to ${MAX_FIELDS} questions.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(fieldModal(uid, type === 'tf_add_long' ? 'long' : 'short'));
    return;
  }

  if (type === 'tf_title') {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`tfm_title::${uid}`)
        .setTitle('Form title')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title of the window members see').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(45).setValue(draft.title))),
    );
    return;
  }

  if (type === 'tf_remove') {
    draft.fields.pop();
    setDraft(uid, draft);
    await interaction.update(renderPanel(uid, draft));
    return;
  }

  if (type === 'tf_cancel') {
    deleteDraft(uid);
    await interaction.update({ components: [textCard(`${EMOJI.DENY} Form not saved.`, 0x8b8fa3)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (type === 'tf_save') {
    await interaction.deferUpdate();
    try {
      const fields = formsDb.normalizeFields(draft.fields.map((f, i) => ({ ...f, id: f.id || `field_${i + 1}` })));
      const form = draft.mode === 'edit'
        ? await formsDb.updateForm(draft.guildId, draft.name, { fields, title: draft.title })
        : await formsDb.createForm({ guildId: draft.guildId, name: draft.name, title: draft.title, fields });
      deleteDraft(uid);
      const next = draft.mode === 'edit' ? '' : ` Assign it with !ticket category edit key:<key> form:${form.name}, or from the dashboard.`;
      await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE} Form \`${form.name}\` saved.${next}`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
      await interaction.followUp({ content: `${EMOJI.DENY} ${err.message || 'Unable to save that form.'}`, flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleModal(interaction) {
  const [type, uid] = interaction.customId.split('::');
  if (!ownerOnly(interaction, uid)) return;

  const draft = getDraft(uid);
  if (!draft) {
    await interaction.reply({ content: 'This form builder expired. Run the command again.', flags: MessageFlags.Ephemeral });
    return;
  }
  const g = (id) => (interaction.fields.getTextInputValue(id) ?? '').trim();

  if (type === 'tfm_title') {
    draft.title = g('title').slice(0, 45) || draft.title;
  } else {
    if (draft.fields.length >= MAX_FIELDS) {
      await interaction.reply({ content: `A form can have up to ${MAX_FIELDS} questions.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const label = g('label');
    if (!label) {
      await interaction.reply({ content: 'The question cannot be empty.', flags: MessageFlags.Ephemeral });
      return;
    }
    const answer = g('required').toLowerCase();
    let n = draft.fields.length + 1;
    while (draft.fields.some((f) => f.id === `field_${n}`)) n++;
    draft.fields.push({
      id: `field_${n}`,
      type: type === 'tfm_long' ? 'long_text' : 'short_text',
      label,
      placeholder: g('hint') || undefined,
      required: !['no', 'n', 'false', 'optional'].includes(answer),
    });
  }

  setDraft(uid, draft);
  await interaction.deferUpdate();
  await interaction.editReply(renderPanel(uid, draft));
}

module.exports = { renderPanel, startDraft, handleButton, handleModal, MAX_FIELDS };
