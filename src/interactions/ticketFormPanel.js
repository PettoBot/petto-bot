// Button-driven builder for reusable ticket forms, so no one has to type the field syntax.
const {
  ModalBuilder,
  LabelBuilder,
  RadioGroupBuilder,
  CheckboxBuilder,
  StringSelectMenuBuilder,
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
const { normalizeField, optionsOf, LIMITS } = require('../utils/ticketFormFields');
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

/** What kind of question a line of the builder is: its type and, where it matters, how many choices or files. */
function kindText(field, lang) {
  switch (field.type) {
    case 'long_text': return t(lang, 'tickets.formBuilder.paragraph');
    case 'short_text': return t(lang, 'tickets.formBuilder.shortAnswer');
    case 'select': return t(lang, 'tickets.formBuilder.kind.select', { count: field.options?.length ?? 0, max: field.max ?? 1 });
    case 'file': return t(lang, `tickets.formBuilder.kind.file.${field.accept === 'images' ? 'images' : 'any'}`, { max: field.max ?? 1 });
    default: return t(lang, `tickets.formBuilder.kind.${field.type}`, { count: field.options?.length ?? 0 });
  }
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
      const asked = f.type === 'check' ? f.required === true : f.type !== 'display' && f.required !== false;
      lines.push(`${i + 1}. **${f.label}**${asked ? ' *' : ''}\n-# ${kindText(f, lang)}${f.placeholder ? ` · ${t(lang, 'tickets.formBuilder.hint', { hint: f.placeholder })}` : ''}`);
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
      btn('tf_add_choice', t(lang, 'tickets.formBuilder.addChoice.button'), ButtonStyle.Primary).setDisabled(full),
      btn('tf_add_file', t(lang, 'tickets.formBuilder.addFile.button'), ButtonStyle.Primary).setDisabled(full),
      btn('tf_add_pick', t(lang, 'tickets.formBuilder.addPick.button'), ButtonStyle.Primary).setDisabled(full),
      btn('tf_add_info', t(lang, 'tickets.formBuilder.addInfo.button')).setDisabled(full),
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

const yesNo = (builder, value) => builder.setDefault(value);

/** The window that asks for a question with choices: the question, the choices (one per line), how they are picked and whether it is required. */
function choiceModal(uid, lang) {
  const option = (value) => ({ label: t(lang, `tickets.formBuilder.modal.choice.kind.${value}`), value });
  return new ModalBuilder().setCustomId(`tfm_choice::${uid}`).setTitle(t(lang, 'tickets.formBuilder.modal.choice.title')).addLabelComponents(
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.question')).setTextInputComponent(new TextInputBuilder().setCustomId('label').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(LIMITS.label).setPlaceholder(t(lang, 'tickets.formBuilder.modal.choice.questionPlaceholder'))),
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.choice.options')).setTextInputComponent(new TextInputBuilder().setCustomId('options').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2500).setPlaceholder(t(lang, 'tickets.formBuilder.modal.choice.optionsPlaceholder'))),
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.choice.kind')).setRadioGroupComponent(new RadioGroupBuilder().setCustomId('kind').setRequired(true).addOptions({ ...option('select'), default: true }, option('radio'), option('checks'))),
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.choice.many')).setCheckboxComponent(new CheckboxBuilder().setCustomId('many')),
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.mustAnswer')).setCheckboxComponent(yesNo(new CheckboxBuilder().setCustomId('required'), true)),
  );
}

/** The window that asks for a file upload: the question, what it takes (pictures or any file), how many files and whether it is required. */
function fileModal(uid, lang) {
  const accept = (value, on) => ({ label: t(lang, `tickets.formBuilder.modal.file.accept.${value}`), value, default: on });
  const count = (n) => ({ label: String(n), value: String(n), default: n === 1 });
  return new ModalBuilder().setCustomId(`tfm_file::${uid}`).setTitle(t(lang, 'tickets.formBuilder.modal.file.title')).addLabelComponents(
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.question')).setTextInputComponent(new TextInputBuilder().setCustomId('label').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(LIMITS.label).setPlaceholder(t(lang, 'tickets.formBuilder.modal.file.questionPlaceholder'))),
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.file.accept')).setRadioGroupComponent(new RadioGroupBuilder().setCustomId('accept').setRequired(true).addOptions(accept('images', true), accept('any', false))),
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.file.max', { max: LIMITS.files })).setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId('max').setMinValues(1).setMaxValues(1).setRequired(true).addOptions(...Array.from({ length: LIMITS.files }, (_unused, i) => count(i + 1)))),
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.mustAnswer')).setCheckboxComponent(yesNo(new CheckboxBuilder().setCustomId('required'), true)),
  );
}

/** The window that asks for a member, role or channel picker, or one checkbox. */
function pickModal(uid, lang) {
  const option = (value, on) => ({ label: t(lang, `tickets.formBuilder.modal.pick.kind.${value}`), value, default: on });
  return new ModalBuilder().setCustomId(`tfm_pick::${uid}`).setTitle(t(lang, 'tickets.formBuilder.modal.pick.title')).addLabelComponents(
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.question')).setTextInputComponent(new TextInputBuilder().setCustomId('label').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(LIMITS.label).setPlaceholder(t(lang, 'tickets.formBuilder.modal.pick.questionPlaceholder'))),
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.pick.kind')).setRadioGroupComponent(new RadioGroupBuilder().setCustomId('kind').setRequired(true).addOptions(option('user', true), option('role', false), option('channel', false), option('check', false))),
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.mustAnswer')).setDescription(t(lang, 'tickets.formBuilder.modal.pick.mustHint')).setCheckboxComponent(yesNo(new CheckboxBuilder().setCustomId('required'), true)),
  );
}

/** The window that asks for a text that only informs (shown above the questions or between them). */
function infoModal(uid, lang) {
  return new ModalBuilder().setCustomId(`tfm_info::${uid}`).setTitle(t(lang, 'tickets.formBuilder.modal.info.title')).addLabelComponents(
    new LabelBuilder().setLabel(t(lang, 'tickets.formBuilder.modal.info.text')).setTextInputComponent(new TextInputBuilder().setCustomId('content').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(LIMITS.content)),
  );
}

const NEW_MODALS = { tf_add_choice: choiceModal, tf_add_file: fileModal, tf_add_pick: pickModal, tf_add_info: infoModal };

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

  if (NEW_MODALS[type]) {
    if (draft.fields.length >= MAX_FIELDS) {
      await interaction.reply({ content: t(lang, 'tickets.formBuilder.full', { max: MAX_FIELDS }), flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(NEW_MODALS[type](uid, lang));
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

const NEW_TYPES = ['tfm_choice', 'tfm_file', 'tfm_pick', 'tfm_info'];
const radioOf = (fields, id) => { try { return fields.getRadioGroup(id) ?? null; } catch { return null; } };
const boxOf = (fields, id) => { try { return fields.getCheckbox(id) === true; } catch { return false; } };

/** The number for the id of the next question: field_1, field_2... the first one no question of the draft has. */
function nextNumber(draft) {
  let n = draft.fields.length + 1;
  while (draft.fields.some((f) => f.id === `field_${n}`)) n++;
  return n;
}

/** The question a window of the builder describes, as a stored question (checked afterwards by normalizeField). */
function newQuestion(type, fields, text) {
  if (type === 'tfm_info') return { type: 'display', content: text('content') };
  const base = { label: text('label'), required: boxOf(fields, 'required') };
  if (type === 'tfm_choice') {
    const kind = { radio: 'radio', checks: 'checkboxes' }[radioOf(fields, 'kind')] ?? 'select';
    const options = optionsOf(text('options'));
    return { ...base, type: kind, options, ...(kind === 'select' && boxOf(fields, 'many') ? { max: options.length } : {}) };
  }
  if (type === 'tfm_file') {
    const max = Number([...(fields.getStringSelectValues('max') ?? [])][0]);
    return { ...base, type: 'file', accept: radioOf(fields, 'accept') === 'any' ? 'any' : 'images', max: Number.isFinite(max) ? max : 1 };
  }
  const kind = radioOf(fields, 'kind');
  return { ...base, type: ['role', 'channel', 'check'].includes(kind) ? kind : 'user' };
}

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
  } else if (NEW_TYPES.includes(type)) {
    if (draft.fields.length >= MAX_FIELDS) {
      await interaction.reply({ content: t(lang, 'tickets.formBuilder.full', { max: MAX_FIELDS }), flags: MessageFlags.Ephemeral });
      return;
    }
    let field;
    try {
      field = normalizeField(newQuestion(type, interaction.fields, g), { lang });
    } catch (err) {
      await interaction.reply({ content: `${EMOJI.DENY} ${err.message}`, flags: MessageFlags.Ephemeral });
      return;
    }
    field.id = `field_${nextNumber(draft)}`;
    draft.fields.push(field);
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
    draft.fields.push({
      id: `field_${nextNumber(draft)}`,
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
