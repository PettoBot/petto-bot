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
const { t, currentLanguage, languageOf } = require('../i18n');

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

/** Starts a builder for a new form (mode "create") or an existing one (mode "edit"); a new form is titled in `lang`. */
function startDraft(userId, { guildId, mode, name, title, fields = [], lang = currentLanguage() }) {
  return setDraft(userId, { guildId, mode, name, title: title === undefined ? t(lang, 'tickets.form.defaultTitle') : title, fields: fields.map((f) => ({ ...f })) });
}

function renderPanel(uid, draft, lang = currentLanguage()) {
  const lines = [
    t(lang, draft.mode === 'edit' ? 'tickets.formBuilder.editing' : 'tickets.formBuilder.building', { emoji: EMOJI.STAR, name: draft.name }),
    '',
    `### 📋 ${draft.title}`,
    '',
  ];
  if (draft.fields.length) {
    draft.fields.forEach((f, i) => {
      const kind = t(lang, f.type === 'long_text' ? 'tickets.formBuilder.paragraph' : 'tickets.formBuilder.shortAnswer');
      lines.push(`${i + 1}. **${f.label}**${f.required === false ? '' : ' *'}\n-# ${kind}${f.placeholder ? ` · ${t(lang, 'tickets.formBuilder.hint', { hint: f.placeholder })}` : ''}`);
    });
  } else {
    lines.push(t(lang, 'tickets.formBuilder.empty'));
  }
  lines.push('', t(lang, 'tickets.formBuilder.footer', { count: draft.fields.length, max: MAX_FIELDS }));

  const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(`${id}::${uid}`).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
  };
  const full = draft.fields.length >= MAX_FIELDS;
  const rows = [
    new ActionRowBuilder().addComponents(
      btn('tf_add_short', t(lang, 'tickets.formBuilder.addShort.button'), ButtonStyle.Primary).setDisabled(full),
      btn('tf_add_long', t(lang, 'tickets.formBuilder.addLong.button'), ButtonStyle.Primary).setDisabled(full),
      btn('tf_remove', t(lang, 'tickets.formBuilder.removeLast.button')).setDisabled(!draft.fields.length),
      btn('tf_title', t(lang, 'tickets.formBuilder.title.button')),
    ),
    new ActionRowBuilder().addComponents(
      btn('tf_save', t(lang, 'tickets.formBuilder.save.button'), ButtonStyle.Success, EMOJI.APPROVE).setDisabled(!draft.fields.length),
      btn('tf_cancel', t(lang, 'tickets.cancel.button'), ButtonStyle.Secondary, EMOJI.DENY),
    ),
  ];

  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return { components: [container, ...rows], flags: MessageFlags.IsComponentsV2 };
}

function ownerOnly(interaction, uid, lang) {
  if (interaction.user.id !== uid) {
    interaction.reply({ content: t(lang, 'tickets.formBuilder.notYours', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    interaction.reply({ content: t(lang, 'tickets.needManageServer', { permission: t(lang, 'core.perm.ManageGuild') }), flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  return true;
}

async function expired(interaction, lang) {
  await interaction.update({ components: [textCard(t(lang, 'tickets.formBuilder.expired'))], flags: MessageFlags.IsComponentsV2 });
}

function fieldModal(uid, type, lang) {
  const input = (id, label, style, required, max, placeholder) => {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
    if (placeholder) field.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(field);
  };
  return new ModalBuilder()
    .setCustomId(`tfm_${type}::${uid}`)
    .setTitle(t(lang, type === 'long' ? 'tickets.formBuilder.modal.long' : 'tickets.formBuilder.modal.short'))
    .addComponents(
      input('label', t(lang, 'tickets.formBuilder.modal.question'), TextInputStyle.Short, true, 45, t(lang, 'tickets.formBuilder.modal.questionPlaceholder')),
      input('hint', t(lang, 'tickets.formBuilder.modal.hint'), TextInputStyle.Short, false, 100),
      input('required', t(lang, 'tickets.formBuilder.modal.required'), TextInputStyle.Short, false, 3, t(lang, 'tickets.formBuilder.modal.yes')),
    );
}

async function handleButton(interaction) {
  const [type, uid] = interaction.customId.split('::');
  const lang = await languageOf(interaction);
  if (!ownerOnly(interaction, uid, lang)) return;

  const draft = getDraft(uid);
  if (!draft) return expired(interaction, lang);

  if (type === 'tf_add_short' || type === 'tf_add_long') {
    if (draft.fields.length >= MAX_FIELDS) {
      await interaction.reply({ content: t(lang, 'tickets.formBuilder.full', { max: MAX_FIELDS }), flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(fieldModal(uid, type === 'tf_add_long' ? 'long' : 'short', lang));
    return;
  }

  if (type === 'tf_title') {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`tfm_title::${uid}`)
        .setTitle(t(lang, 'tickets.formBuilder.titleModal.title'))
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel(t(lang, 'tickets.formBuilder.titleModal.label')).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(45).setValue(draft.title))),
    );
    return;
  }

  if (type === 'tf_remove') {
    draft.fields.pop();
    setDraft(uid, draft);
    await interaction.update(renderPanel(uid, draft, lang));
    return;
  }

  if (type === 'tf_cancel') {
    deleteDraft(uid);
    await interaction.update({ components: [textCard(t(lang, 'tickets.formBuilder.cancelled', { emoji: EMOJI.DENY }))], flags: MessageFlags.IsComponentsV2 });
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
      const saved = t(lang, draft.mode === 'edit' ? 'tickets.formBuilder.saved' : 'tickets.formBuilder.savedNew', { emoji: EMOJI.APPROVE, name: form.name });
      await interaction.editReply({ components: [textCard(saved, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
      await interaction.followUp({ content: `${EMOJI.DENY} ${err.message || t(lang, 'tickets.formBuilder.saveFailed')}`, flags: MessageFlags.Ephemeral });
    }
  }
}

// "no" also in Portuguese ("não"), since the question is asked in the language of the server.
const NO_ANSWERS = ['no', 'n', 'false', 'optional', 'não', 'nao'];

async function handleModal(interaction) {
  const [type, uid] = interaction.customId.split('::');
  const lang = await languageOf(interaction);
  if (!ownerOnly(interaction, uid, lang)) return;

  const draft = getDraft(uid);
  if (!draft) {
    await interaction.reply({ content: t(lang, 'tickets.formBuilder.expired'), flags: MessageFlags.Ephemeral });
    return;
  }
  const g = (id) => (interaction.fields.getTextInputValue(id) ?? '').trim();

  if (type === 'tfm_title') {
    draft.title = g('title').slice(0, 45) || draft.title;
  } else {
    if (draft.fields.length >= MAX_FIELDS) {
      await interaction.reply({ content: t(lang, 'tickets.formBuilder.full', { max: MAX_FIELDS }), flags: MessageFlags.Ephemeral });
      return;
    }
    const label = g('label');
    if (!label) {
      await interaction.reply({ content: t(lang, 'tickets.formBuilder.emptyQuestion'), flags: MessageFlags.Ephemeral });
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
      required: !NO_ANSWERS.includes(answer),
    });
  }

  setDraft(uid, draft);
  await interaction.deferUpdate();
  await interaction.editReply(renderPanel(uid, draft, lang));
}

module.exports = { renderPanel, startDraft, handleButton, handleModal, MAX_FIELDS };
