// The questions of a ticket form: what a question can be, how a stored question is checked and cleaned, the modal members see when they
// press a panel button, and how what they sent becomes answers. Nothing here talks to Discord or the database.
//
// A question is stored as an object in the `fields` column of ticket_forms (JSONB), so a new kind of question needs no new column. Every
// question keeps `id`, `type`, `label` and `required`; the other keys depend on the type:
//   short_text, long_text   placeholder
//   select                  options (1-25 texts), max (how many can be picked, 1 by default), placeholder
//   radio                   options (2-10 texts)
//   checkboxes              options (1-10 texts), max
//   check                   one box; `required: true` means the member has to tick it (Discord itself cannot require a box)
//   file                    accept ("images" or "any"), max (1-5 files)
//   user, role, channel     max (1-25), placeholder
//   display                 content: a text that only informs
// The parts are built and read by utils/modalParts.js, the same code that Petto Code's forms use.
const { ModalBuilder } = require('discord.js');
const { addModalParts, submittedFields } = require('./modalParts');
const { t, currentLanguage } = require('../i18n');

const FIELD_TYPES = ['short_text', 'long_text', 'select', 'radio', 'checkboxes', 'check', 'file', 'user', 'role', 'channel', 'display'];
// What a person may type instead of the exact name (the `!ticket form` command takes them).
const TYPE_ALIASES = {
  short: 'short_text', text: 'short_text', paragraph: 'long_text', long: 'long_text', dropdown: 'select', menu: 'select', choice: 'select', choices: 'select',
  checks: 'checkboxes', checkbox: 'check', member: 'user', users: 'user', roles: 'role', channels: 'channel', info: 'display', text_only: 'display', files: 'file', image: 'file', images: 'file',
};
const CHOICE_TYPES = ['select', 'radio', 'checkboxes'];
const PICKER_TYPES = ['user', 'role', 'channel'];
const MAX_QUESTIONS = 5;
const LIMITS = { label: 45, description: 100, placeholder: 100, menuPlaceholder: 150, option: 100, content: 1000, id: 40, text: 4000, files: 5, picks: 25 };
const OPTION_RANGE = { select: [1, 25], radio: [2, 10], checkboxes: [1, 10] };
const PICKER_PARTS = { user: 'users', role: 'roles', channel: 'channels' };
const FILE_ACCEPT = ['images', 'any'];

const clip = (value, max) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const whole = (value, min, max, fallback) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** The exact name of a type of question from what was written, or null. */
function typeOf(value) {
  const name = String(value ?? 'short_text').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const exact = FIELD_TYPES.includes(name) ? name : TYPE_ALIASES[name];
  return exact ?? null;
}

/** The choices of a question from a list or from lines of text: texts of up to 100 characters, no empty one, none twice. */
function optionsOf(value) {
  const rows = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const text = clip(row !== null && typeof row === 'object' ? (row.label ?? row.value) : row, LIMITS.option);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function fail(lang, key, vars) {
  return new Error(t(lang, key, vars));
}

/**
 * One question, cleaned. In strict mode (what a person is saving) a mistake throws an error that says what is wrong, in `lang`; otherwise
 * (a form already saved, read to show it) the question is cut down to what Discord takes, or null when nothing can be done with it.
 * A text question comes out exactly as it always did: { id, type, label, placeholder, required }.
 */
function cleanField(field, index, { strict, lang }) {
  const number = index + 1;
  const type = typeOf(field?.type);
  if (!type) { if (strict) throw fail(lang, 'tickets.db.form.fieldType', { number }); return null; }
  const id = String(field.id ?? field.label ?? `field_${number}`).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, LIMITS.id) || `field_${number}`;

  if (type === 'display') {
    const content = clip(field.content ?? field.label, LIMITS.content);
    if (!content) { if (strict) throw fail(lang, 'tickets.db.form.displayText', { number }); return null; }
    return { id, type, label: clip(content.replace(/\s+/g, ' '), LIMITS.label), content };
  }

  const label = clip(field.label, LIMITS.label);
  if (!label) { if (strict) throw fail(lang, 'tickets.db.form.fieldLabel', { number }); return null; }
  const out = { id, type, label };
  const description = clip(field.description, LIMITS.description);
  if (description) out.description = description;

  if (type === 'short_text' || type === 'long_text') {
    out.placeholder = clip(field.placeholder, LIMITS.placeholder) || undefined;
    out.required = field.required !== false;
    return out;
  }

  if (type === 'check') {
    if (field.required === true) out.required = true;
    return out;
  }

  out.required = field.required !== false;
  const placeholder = clip(field.placeholder, LIMITS.menuPlaceholder);

  if (CHOICE_TYPES.includes(type)) {
    const [min, max] = OPTION_RANGE[type];
    const options = optionsOf(field.options);
    if (options.length < min || (strict && options.length > max)) {
      if (strict) throw fail(lang, 'tickets.db.form.fieldOptions', { number, min, max });
      if (options.length < min) return null;
    }
    out.options = options.slice(0, max);
    if (type === 'select') {
      out.max = whole(field.max, 1, out.options.length, 1);
      if (placeholder) out.placeholder = placeholder;
    }
    if (type === 'checkboxes') out.max = whole(field.max, 1, out.options.length, out.options.length);
    return out;
  }

  if (type === 'file') {
    out.accept = FILE_ACCEPT.includes(field.accept) ? field.accept : 'any';
    out.max = whole(field.max, 1, LIMITS.files, 1);
    return out;
  }

  // user, role, channel
  out.max = whole(field.max, 1, LIMITS.picks, 1);
  if (placeholder) out.placeholder = placeholder;
  return out;
}

/**
 * The questions of a form checked and cleaned. In strict mode (saving) it throws when a form has no 1 to 5 questions, no question that people
 * fill in (a text that only informs is not one) or a mistake in a question. Otherwise it never throws: what cannot be used is left out.
 * Two questions never share an id (the second one gets a number), because each one is a part of the same modal.
 */
function normalizeFields(fields, { strict = true, lang = currentLanguage() } = {}) {
  if (!Array.isArray(fields) || (strict && (fields.length < 1 || fields.length > MAX_QUESTIONS))) throw fail(lang, 'tickets.db.form.fieldCount');
  const used = new Set();
  const out = [];
  for (const [index, field] of fields.entries()) {
    if (out.length >= MAX_QUESTIONS) break;
    const clean = cleanField(field, index, { strict, lang });
    if (!clean) continue;
    let id = clean.id;
    for (let n = 2; used.has(id); n += 1) id = `${clean.id.slice(0, LIMITS.id - 3)}_${n}`;
    used.add(id);
    out.push({ ...clean, id });
  }
  const fillable = out.some((field) => field.type !== 'display');
  if (strict && !fillable) throw fail(lang, 'tickets.db.form.needsInput');
  return fillable ? out : [];
}

/** One question checked the way a person saving it is: throws an error that says what is wrong (in `lang`), else the clean question. */
function normalizeField(field, { lang = currentLanguage(), index = 0 } = {}) {
  return cleanField(field, index, { strict: true, lang });
}

/** The questions of a saved form, ready to show: never throws, and is [] when nothing in it can be asked. */
function usableFields(fields) {
  try { return normalizeFields(fields, { strict: false }); } catch { return []; }
}

const customIdOf = (field) => `field::${field.id}`;

/** The questions as the parts that utils/modalParts.js builds (the same shape Petto Code's `ctext`, `cmenu`, `cfile`... make). */
function modalFields(fields) {
  return fields.map((field) => {
    if (field.type === 'display') return { type: 'display', content: field.content };
    const base = { id: customIdOf(field), label: field.label, required: field.required !== false };
    if (field.description) base.description = field.description;
    const options = () => (field.options ?? []).map((text) => ({ label: text, value: text }));
    switch (field.type) {
      case 'short_text': case 'long_text':
        return { ...base, type: 'textInput', style: field.type === 'long_text' ? 2 : 1, min: 0, max: LIMITS.text, ...(field.placeholder ? { placeholder: field.placeholder } : {}) };
      case 'select':
        return { ...base, type: 'menu', options: options(), min: base.required ? 1 : 0, max: field.max ?? 1, ...(field.placeholder ? { placeholder: field.placeholder } : {}) };
      case 'radio':
        return { ...base, type: 'radio', options: options() };
      case 'checkboxes':
        return { ...base, type: 'checks', options: options(), min: base.required ? 1 : 0, max: field.max ?? field.options.length };
      case 'check':
        return { id: base.id, label: field.label, type: 'check', default: false, ...(field.description ? { description: field.description } : {}) };
      case 'file':
        return { ...base, type: 'file', min: base.required ? 1 : 0, max: field.max ?? 1 };
      default:
        return { ...base, type: PICKER_PARTS[field.type], min: base.required ? 1 : 0, max: field.max ?? 1, ...(field.placeholder ? { placeholder: field.placeholder } : {}) };
    }
  });
}

/** The modal of a form: its questions under their labels, up to 5 parts (what Discord allows). */
function buildFormModal({ customId, title, fields }) {
  return addModalParts(new ModalBuilder().setCustomId(customId).setTitle(String(title).slice(0, 45)), modalFields(fields));
}

const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp)$/i;
const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i;

/** Whether what Discord says about a file (its type, or its name when it says no type) is one of the pictures Petto draws. */
function looksLikeImage(file) {
  const type = String(file?.type ?? '').split(';')[0].trim();
  if (type && type !== 'application/octet-stream') return IMAGE_TYPE.test(type);
  return IMAGE_NAME.test(String(file?.name ?? ''));
}

/**
 * What the member sent, question by question: `entries` ({ id, type, label, required, value, empty }, in the order of the form; value is a
 * text, a list of the chosen texts, true or false, a list of files { id, name, url, size, type } or a list of ids) and `missing`, the
 * questions that are required and were left empty. `collection` is `interaction.fields.fields`.
 */
function readAnswers(fields, collection) {
  const got = submittedFields(collection);
  const entries = [];
  const missing = [];
  for (const field of fields) {
    if (field.type === 'display') continue;
    const raw = got.Fields[customIdOf(field)];
    let value;
    let empty;
    switch (field.type) {
      case 'short_text': case 'long_text':
        value = typeof raw === 'string' ? raw.trim() : ''; empty = !value; break;
      case 'select': case 'checkboxes':
        value = (Array.isArray(raw) ? raw : []).filter((text) => field.options.includes(text)); empty = !value.length; break;
      case 'radio':
        value = typeof raw === 'string' && field.options.includes(raw) ? [raw] : []; empty = !value.length; break;
      case 'check':
        value = raw === true; empty = !value; break;
      case 'file':
        value = (Array.isArray(raw) ? raw : []).map((file) => ({ id: String(file.ID ?? ''), name: String(file.Name ?? 'file'), url: String(file.URL ?? ''), size: Number(file.Size) || 0, type: String(file.Type ?? '') })).slice(0, field.max ?? LIMITS.files);
        empty = !value.length; break;
      default:
        value = (Array.isArray(raw) ? raw : []).map(String).filter((id) => /^\d{1,25}$/.test(id)).slice(0, field.max ?? 1); empty = !value.length;
    }
    const required = field.type === 'check' ? field.required === true : field.required !== false;
    entries.push({ id: field.id, type: field.type, label: field.label, required, value, empty, ...(field.type === 'file' ? { accept: field.accept ?? 'any' } : {}) });
    if (required && empty) missing.push(field.label);
  }
  return { entries, missing };
}

module.exports = { FIELD_TYPES, CHOICE_TYPES, PICKER_TYPES, FILE_ACCEPT, MAX_QUESTIONS, LIMITS, typeOf, optionsOf, normalizeField, normalizeFields, usableFields, modalFields, buildFormModal, looksLikeImage, readAnswers, customIdOf };
