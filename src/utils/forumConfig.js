// Forum support: the rules of a setup (what each setting may hold and how it is cleaned), the form members fill in to open a post, who may
// open one, and the tags they may pick. Nothing here talks to Discord or the database: the actions are in forumActions.js.
//
// A setup is a row of `forum_setups` (see schema.sql). The dashboard saves its rows straight in the database, so every column has a check
// there too; `normalizeSetup` is how the bot cleans a row it reads or a change a command made (it never throws: what cannot be used is dropped).
const { ModalBuilder, PermissionFlagsBits } = require('discord.js');
const { addModalParts } = require('./modalParts');
const { usableFields, modalFields, readAnswers, MAX_QUESTIONS } = require('./ticketFormFields');
const { t, currentLanguage } = require('../i18n');

const MAX_SETUPS = 5;
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SNOWFLAKE = /^\d{15,25}$/;
const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'];
const LOG_EVENTS = ['opened', 'locked', 'closed', 'solved'];
const STATUSES = ['open', 'solved', 'locked', 'closed'];
const OPEN_STATUSES = ['open', 'solved'];
const LIMITS = { title: 100, description: 1800, label: 45, panelTitle: 200, panelText: 2000, panelFooter: 300, button: 80, firstMessage: 1500, guidelines: 1500, roles: 25, users: 50, tags: 20, extra: 3 };
const THREAD_NAME_MAX = 100;
const SLOWMODE_MAX = 21600;

// What the bot needs in the forum channel. The first group stops everything when it is missing; the second only limits one feature.
const REQUIRED_PERMISSIONS = ['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'ManageThreads'];
const OPTIONAL_PERMISSIONS = ['CreatePublicThreads', 'AttachFiles', 'ManageChannels'];

const DEFAULTS = {
  enabled: true,
  button_style: 'success',
  extra_fields: [],
  ask_images: false,
  require_tag: false,
  tag_ids: [],
  max_tags: 1,
  first_message_style: 'plain',
  ping_role_ids: [],
  slowmode_seconds: 0,
  staff_role_ids: [],
  required_role_ids: [],
  blocked_role_ids: [],
  blocked_user_ids: [],
  max_open_per_user: 3,
  cooldown_seconds: 30,
  author_can_close: true,
  author_can_solve: true,
  author_can_rename: true,
  inactive_days: 0,
  inactive_action: 'close',
  solved_action: 'none',
  solved_delay_hours: 24,
  adopt: false,
  tag_wait_minutes: 10,
  log_events: [...LOG_EVENTS],
};

const clip = (value, max) => String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const textOrNull = (value, max) => clip(value, max) || null;
const whole = (value, min, max, fallback) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const flag = (value, fallback) => (typeof value === 'boolean' ? value : value === 'true' || value === 'on' ? true : value === 'false' || value === 'off' ? false : fallback);
const oneOf = (value, list, fallback) => (list.includes(String(value)) ? String(value) : fallback);
const ids = (value, max) => [...new Set((Array.isArray(value) ? value : []).map(String).filter((id) => SNOWFLAKE.test(id)))].slice(0, max);
const colorOf = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value.trim()) ? parseInt(value.trim().replace('#', ''), 16) : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 0xffffff ? n : null;
};
const httpsLink = (value) => {
  const text = clip(value, 500);
  return /^https:\/\/\S+$/i.test(text) ? text : null;
};

/** A short name from what was typed: lower case letters, digits, `-` and `_`, up to 32. */
function slugName(value) {
  const slug = String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 32);
  return NAME.test(slug) ? slug : '';
}

/**
 * The extra questions of the form: the kinds of ticket forms, at most three (the title and the description take two of the five parts of a
 * form), and fewer when pictures are asked for (they take one more).
 */
function extraQuestions(fields, askImages = false) {
  return usableFields(fields).filter((field) => field.type !== 'display').slice(0, askImages ? LIMITS.extra - 1 : LIMITS.extra);
}

/**
 * A setup, or a change to one (only the keys that are given), cleaned: every value in its range, ids that look like ids, lists without
 * repeats, texts cut to their limits, and an unknown value replaced by the usual one. Keys of the row that are not settings are kept as they are.
 */
function normalizeSetup(input = {}) {
  const has = (key) => Object.hasOwn(input, key);
  const out = {};
  const put = (key, value) => { if (has(key)) out[key] = value(input[key]); };
  put('name', (v) => slugName(v) || String(v ?? ''));
  put('forum_channel_id', (v) => (SNOWFLAKE.test(String(v)) ? String(v) : ''));
  put('enabled', (v) => flag(v, DEFAULTS.enabled));
  put('panel_channel_id', (v) => (SNOWFLAKE.test(String(v ?? '')) ? String(v) : null));
  put('panel_message_id', (v) => (SNOWFLAKE.test(String(v ?? '')) ? String(v) : null));
  put('panel_template', (v) => textOrNull(v, 100));
  put('panel_title', (v) => textOrNull(v, LIMITS.panelTitle));
  put('panel_description', (v) => textOrNull(v, LIMITS.panelText));
  put('panel_color', colorOf);
  put('panel_image', httpsLink);
  put('panel_footer', (v) => textOrNull(v, LIMITS.panelFooter));
  put('button_label', (v) => textOrNull(v, LIMITS.button));
  put('button_emoji', (v) => textOrNull(v, 100));
  put('button_style', (v) => oneOf(v, BUTTON_STYLES, DEFAULTS.button_style));
  put('modal_title', (v) => textOrNull(v, LIMITS.label));
  put('title_label', (v) => textOrNull(v, LIMITS.label));
  put('description_label', (v) => textOrNull(v, LIMITS.label));
  put('ask_images', (v) => flag(v, DEFAULTS.ask_images));
  put('require_tag', (v) => flag(v, DEFAULTS.require_tag));
  put('tag_ids', (v) => ids(v, LIMITS.tags));
  put('max_tags', (v) => whole(v, 1, 5, DEFAULTS.max_tags));
  put('solved_tag_id', (v) => (SNOWFLAKE.test(String(v ?? '')) ? String(v) : null));
  put('first_message', (v) => textOrNull(v, LIMITS.firstMessage));
  put('first_message_style', (v) => oneOf(v, ['plain', 'card'], DEFAULTS.first_message_style));
  put('guidelines', (v) => textOrNull(v, LIMITS.guidelines));
  put('ping_role_ids', (v) => ids(v, LIMITS.roles));
  put('slowmode_seconds', (v) => whole(v, 0, SLOWMODE_MAX, 0));
  put('staff_role_ids', (v) => ids(v, LIMITS.roles));
  put('required_role_ids', (v) => ids(v, LIMITS.roles));
  put('blocked_role_ids', (v) => ids(v, LIMITS.roles));
  put('blocked_user_ids', (v) => ids(v, LIMITS.users));
  put('max_open_per_user', (v) => whole(v, 0, 50, DEFAULTS.max_open_per_user));
  put('cooldown_seconds', (v) => whole(v, 0, 86400, DEFAULTS.cooldown_seconds));
  put('author_can_close', (v) => flag(v, true));
  put('author_can_solve', (v) => flag(v, true));
  put('author_can_rename', (v) => flag(v, true));
  put('inactive_days', (v) => whole(v, 0, 365, 0));
  put('inactive_action', (v) => oneOf(v, ['lock', 'close'], DEFAULTS.inactive_action));
  put('solved_action', (v) => oneOf(v, ['none', 'lock', 'close'], DEFAULTS.solved_action));
  put('solved_delay_hours', (v) => whole(v, 0, 720, DEFAULTS.solved_delay_hours));
  put('adopt', (v) => flag(v, false));
  put('tag_wait_minutes', (v) => whole(v, 1, 1440, DEFAULTS.tag_wait_minutes));
  put('log_events', (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((name) => LOG_EVENTS.includes(name)))]);
  // The questions need the choice about pictures: from the input when it is there, else from what was stored.
  if (has('extra_fields')) out.extra_fields = extraQuestions(input.extra_fields, has('ask_images') ? out.ask_images : Boolean(input.ask_images));
  return out;
}

/** A row from the database with the usual value for everything that is missing. */
function withDefaults(row) {
  return { ...DEFAULTS, ...(row ?? {}), ...normalizeSetup(Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => key in DEFAULTS))) };
}

/** `Post opened by {user} - {title}`: `{name}` words replaced by their values (an unknown word is left as it is). */
function renderTemplate(text, vars) {
  return String(text ?? '').replace(/\{([a-z_]+)\}/gi, (whole_, key) => (Object.hasOwn(vars, key.toLowerCase()) ? String(vars[key.toLowerCase()] ?? '') : whole_));
}

/** The text of the first message of a post, cut to what a message takes (2000): the description gives way, never the first line. */
function firstMessageText(setup, { user, username, title, description, tags, server, forum, lang = currentLanguage() }) {
  const card = setup.first_message_style === 'card';
  const template = setup.first_message || t(lang, card ? 'forums.post.firstCard' : 'forums.post.first');
  const base = { user, username, title, tag: tags, tags, server, forum };
  const withoutDescription = renderTemplate(template, { ...base, description: '' });
  const room = Math.max(0, 2000 - withoutDescription.length);
  const shortened = description.length > room ? `${description.slice(0, Math.max(0, room - 1))}…` : description;
  return renderTemplate(template, { ...base, description: shortened }).slice(0, 2000).trim();
}

// ── the form ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const TITLE_ID = 'forum::title';
const DESCRIPTION_ID = 'forum::description';
const IMAGES_ID = 'field::forum_images';

/** The question of pictures, as one more question of the form (a picture upload, optional, up to three). */
function imagesQuestion(lang) {
  return { id: 'forum_images', type: 'file', label: t(lang, 'forums.modal.images'), required: false, accept: 'images', max: 3 };
}

/** The questions after the title and the description: the setup's own, and the pictures when they are asked for. */
function formQuestions(setup, lang = currentLanguage()) {
  const own = extraQuestions(setup.extra_fields, Boolean(setup.ask_images));
  return setup.ask_images ? [...own, imagesQuestion(lang)] : own;
}

/** The form members see when they press the button: title and description first, then the other questions (five parts at most). */
function buildOpenModal(setup, { lang = currentLanguage() } = {}) {
  const parts = [
    { id: TITLE_ID, label: setup.title_label || t(lang, 'forums.modal.title'), type: 'textInput', style: 1, required: true, min: 1, max: LIMITS.title, placeholder: t(lang, 'forums.modal.titlePlaceholder') },
    { id: DESCRIPTION_ID, label: setup.description_label || t(lang, 'forums.modal.description'), type: 'textInput', style: 2, required: true, min: 1, max: LIMITS.description, placeholder: t(lang, 'forums.modal.descriptionPlaceholder') },
    ...modalFields(formQuestions(setup, lang)),
  ].slice(0, 5);
  const modal = new ModalBuilder().setCustomId(`forum:modal:${setup.id}`).setTitle((setup.modal_title || t(lang, 'forums.modal.heading')).slice(0, 45));
  return addModalParts(modal, parts);
}

/**
 * What was sent in the form: the title, the description, the answers of the other questions (`entries`, see readAnswers) and `missing`, the
 * required questions left empty. `collection` is `interaction.fields.fields`.
 */
function readOpenModal(setup, collection, { lang = currentLanguage() } = {}) {
  const text = (id) => {
    const field = collection?.get?.(id);
    return typeof field?.value === 'string' ? field.value : '';
  };
  const title = clip(text(TITLE_ID).replace(/\s+/g, ' '), THREAD_NAME_MAX);
  const description = clip(text(DESCRIPTION_ID), LIMITS.description);
  const { entries, missing } = readAnswers(formQuestions(setup, lang), collection);
  return { title, description, entries, missing };
}

// ── who may open a post ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Why a member may not open a post now, or null: `{ code, vars }` with the code of `forums.refuse.<code>`. `stats` holds what the index knows:
 * `open` (their open posts: `{ thread_id }`), `lastOpenedAt`. `member` is a discord.js member (or anything with `roles.cache` and `id`).
 */
function checkEligibility(setup, member, { open = [], lastOpenedAt = null, now = Date.now() } = {}) {
  if (!setup.enabled) return { code: 'disabled', vars: {} };
  const roles = member?.roles?.cache;
  const has = (id) => Boolean(roles?.has?.(id));
  if ((setup.blocked_user_ids ?? []).includes(String(member?.id))) return { code: 'blocked', vars: {} };
  if ((setup.blocked_role_ids ?? []).some(has)) return { code: 'blocked', vars: {} };
  const required = setup.required_role_ids ?? [];
  if (required.length && !required.some(has)) return { code: 'roles', vars: { roles: required.map((id) => `<@&${id}>`).join(', ') } };
  if (setup.max_open_per_user > 0 && open.length >= setup.max_open_per_user) {
    return { code: 'limit', vars: { count: open.length, limit: setup.max_open_per_user, posts: open.slice(0, 5).map((post) => `<#${post.thread_id}>`).join(' ') } };
  }
  if (setup.cooldown_seconds > 0 && lastOpenedAt) {
    const wait = Math.ceil((new Date(lastOpenedAt).getTime() + setup.cooldown_seconds * 1000 - now) / 1000);
    if (wait > 0) return { code: 'cooldown', vars: { seconds: wait } };
  }
  return null;
}

// ── tags ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const lower = (text) => String(text ?? '').trim().toLowerCase();
const SOLVED_NAMES = ['solved', 'resuelto', 'resuelta', 'resolvido', 'resolvida', 'solucionado'];

/** The tag that means solved: the one the setup chose, else a tag of the forum named like it. Null when there is none. */
function solvedTagOf(forum, setup) {
  const tags = forum?.availableTags ?? [];
  if (setup?.solved_tag_id) {
    const chosen = tags.find((tag) => tag.id === setup.solved_tag_id);
    if (chosen) return chosen;
  }
  return tags.find((tag) => SOLVED_NAMES.includes(lower(tag.name))) ?? null;
}

/**
 * The tags a member can pick when opening a post: the forum's tags that the setup allows (all of them when it chose none), without the one that
 * means solved, and without the tags only moderators can use unless `canModerate`. At most 25 (what a menu holds).
 */
function tagChoices(forum, setup, { canModerate = false } = {}) {
  const solved = solvedTagOf(forum, setup);
  const allowed = setup.tag_ids?.length ? new Set(setup.tag_ids) : null;
  return (forum?.availableTags ?? [])
    .filter((tag) => (!allowed || allowed.has(tag.id)) && tag.id !== solved?.id && (canModerate || !tag.moderated))
    .slice(0, 25);
}

/** A tag by its name (any case) or id among a list of tags, or null. */
function findTag(tags, reference) {
  const wanted = lower(reference).replace(/^["']|["']$/g, '');
  if (!wanted) return null;
  return tags.find((tag) => tag.id === wanted) ?? tags.find((tag) => lower(tag.name) === wanted) ?? tags.find((tag) => lower(tag.name).startsWith(wanted)) ?? null;
}

/** The names of the permissions the bot lacks in a channel, from a list of flag names (empty when it has all). */
function missingPermissions(channel, me, names = REQUIRED_PERMISSIONS) {
  const allowed = channel?.permissionsFor?.(me);
  if (!allowed) return [...names];
  return names.filter((name) => !allowed.has(PermissionFlagsBits[name]));
}

// ── `!forum move` ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const MESSAGE_LINK = /https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i;

/**
 * What was typed after `!forum move`: a link to the message (or its id; a reply to the message needs neither), the forum (`#support`, a
 * mention or the name of a setup) and the title, in any order of link and forum but the title last.
 * `names` are the names of the setups of the server. Returns { message: { guildId, channelId, messageId } | { messageId } | null, forum, title }.
 */
function parseMoveArgs(text, names = []) {
  let rest = String(text ?? '');
  let message = null;
  const link = MESSAGE_LINK.exec(rest);
  if (link) {
    message = { guildId: link[1], channelId: link[2], messageId: link[3] };
    rest = rest.replace(link[0], ' ');
  }
  const words = rest.trim().split(/\s+/).filter(Boolean);
  if (!message && /^\d{17,20}$/.test(words[0] ?? '')) message = { messageId: words.shift() };
  let forum = null;
  const first = words[0] ?? '';
  const mention = /^<#(\d{15,25})>$/.exec(first);
  if (mention) { forum = mention[1]; words.shift(); }
  else if (first.startsWith('#') && first.length > 1) { forum = first.slice(1); words.shift(); }
  else if (names.includes(first.toLowerCase())) { forum = first.toLowerCase(); words.shift(); }
  return { message, forum, title: words.join(' ') };
}

// ── what `!forum set` changes ──────────────────────────────────────────────────────────────────────────────────────────

const BOOLEAN_WORDS = { on: true, yes: true, true: true, enable: true, enabled: true, '1': true, off: false, no: false, false: false, disable: false, disabled: false, '0': false };

/**
 * The settings `!forum set <setting> <value>` can change. `kind` says how the value is read: `bool`, `int` (min, max), `choice`, `text`
 * (max; "none" clears it), `roles` (a list of roles, "none" clears it; `ctx.resolveRoles` reads them), `users` or `minutes`/`hours`
 * (a number in that unit). `column` is where it lives in forum_setups.
 */
const SETTINGS = {
  'max-open': { column: 'max_open_per_user', kind: 'int', min: 0, max: 50 },
  cooldown: { column: 'cooldown_seconds', kind: 'int', min: 0, max: 86400 },
  slowmode: { column: 'slowmode_seconds', kind: 'int', min: 0, max: SLOWMODE_MAX },
  'inactive-days': { column: 'inactive_days', kind: 'int', min: 0, max: 365 },
  'inactive-action': { column: 'inactive_action', kind: 'choice', choices: ['lock', 'close'] },
  'solved-action': { column: 'solved_action', kind: 'choice', choices: ['none', 'lock', 'close'] },
  'solved-delay': { column: 'solved_delay_hours', kind: 'int', min: 0, max: 720 },
  'require-tag': { column: 'require_tag', kind: 'bool' },
  'max-tags': { column: 'max_tags', kind: 'int', min: 1, max: 5 },
  'tag-wait': { column: 'tag_wait_minutes', kind: 'int', min: 1, max: 1440 },
  adopt: { column: 'adopt', kind: 'bool' },
  images: { column: 'ask_images', kind: 'bool' },
  'author-close': { column: 'author_can_close', kind: 'bool' },
  'author-solve': { column: 'author_can_solve', kind: 'bool' },
  'author-rename': { column: 'author_can_rename', kind: 'bool' },
  'first-message-style': { column: 'first_message_style', kind: 'choice', choices: ['plain', 'card'] },
  'button-style': { column: 'button_style', kind: 'choice', choices: BUTTON_STYLES },
  'staff-roles': { column: 'staff_role_ids', kind: 'roles' },
  'ping-roles': { column: 'ping_role_ids', kind: 'roles' },
  'required-roles': { column: 'required_role_ids', kind: 'roles' },
  'blocked-roles': { column: 'blocked_role_ids', kind: 'roles' },
  guidelines: { column: 'guidelines', kind: 'text', max: LIMITS.guidelines },
  'first-message': { column: 'first_message', kind: 'text', max: LIMITS.firstMessage },
  'panel-title': { column: 'panel_title', kind: 'text', max: LIMITS.panelTitle },
  'panel-text': { column: 'panel_description', kind: 'text', max: LIMITS.panelText },
  'panel-footer': { column: 'panel_footer', kind: 'text', max: LIMITS.panelFooter },
  'panel-image': { column: 'panel_image', kind: 'link' },
  'panel-color': { column: 'panel_color', kind: 'color' },
  'panel-design': { column: 'panel_template', kind: 'text', max: 100 },
  'button-label': { column: 'button_label', kind: 'text', max: LIMITS.button },
  'button-emoji': { column: 'button_emoji', kind: 'text', max: 100 },
  'modal-title': { column: 'modal_title', kind: 'text', max: LIMITS.label },
  'title-label': { column: 'title_label', kind: 'text', max: LIMITS.label },
  'description-label': { column: 'description_label', kind: 'text', max: LIMITS.label },
};

const CLEAR_WORDS = new Set(['none', 'off', 'clear', 'reset', 'default', '-']);

/**
 * Reads the value of one setting: `{ ok: true, patch }` (the columns to save) or `{ ok: false, key, vars }` (the key of the error text in the
 * catalog, `forums.set.<key>`). `ctx.roles(text)` turns the words typed into role ids (roles of the server the member may use).
 */
function parseSetting(setting, raw, ctx = {}) {
  const spec = SETTINGS[String(setting ?? '').toLowerCase()];
  if (!spec) return { ok: false, key: 'unknown', vars: { setting: String(setting ?? '') } };
  const text = String(raw ?? '').trim();
  const clear = CLEAR_WORDS.has(text.toLowerCase());
  if (!text) return { ok: false, key: 'needsValue', vars: { setting: setting.toLowerCase() } };
  switch (spec.kind) {
    case 'bool': {
      const value = BOOLEAN_WORDS[text.toLowerCase()];
      return value === undefined ? { ok: false, key: 'bool', vars: { setting } } : { ok: true, patch: { [spec.column]: value } };
    }
    case 'int': {
      const n = Number(text);
      if (!Number.isInteger(n) || n < spec.min || n > spec.max) return { ok: false, key: 'int', vars: { setting, min: spec.min, max: spec.max } };
      return { ok: true, patch: { [spec.column]: n } };
    }
    case 'choice': {
      const value = text.toLowerCase();
      return spec.choices.includes(value) ? { ok: true, patch: { [spec.column]: value } } : { ok: false, key: 'choice', vars: { setting, choices: spec.choices.join(', ') } };
    }
    case 'text':
      return { ok: true, patch: { [spec.column]: clear ? null : clip(text, spec.max) } };
    case 'link': {
      if (clear) return { ok: true, patch: { [spec.column]: null } };
      const link = httpsLink(text);
      return link ? { ok: true, patch: { [spec.column]: link } } : { ok: false, key: 'link', vars: { setting } };
    }
    case 'color': {
      if (clear) return { ok: true, patch: { [spec.column]: null } };
      const color = colorOf(text);
      return color === null ? { ok: false, key: 'color', vars: { setting } } : { ok: true, patch: { [spec.column]: color } };
    }
    case 'roles': {
      if (clear) return { ok: true, patch: { [spec.column]: [] } };
      const found = typeof ctx.roles === 'function' ? ctx.roles(text) : [];
      return found.length ? { ok: true, patch: { [spec.column]: ids(found, LIMITS.roles) } } : { ok: false, key: 'roles', vars: { setting } };
    }
    default:
      return { ok: false, key: 'unknown', vars: { setting } };
  }
}

module.exports = {
  MAX_SETUPS, NAME, SNOWFLAKE, BUTTON_STYLES, LOG_EVENTS, STATUSES, OPEN_STATUSES, LIMITS, THREAD_NAME_MAX, SLOWMODE_MAX, REQUIRED_PERMISSIONS, OPTIONAL_PERMISSIONS, DEFAULTS, MAX_QUESTIONS, SETTINGS,
  slugName, parseMoveArgs, normalizeSetup, withDefaults, extraQuestions, renderTemplate, firstMessageText, formQuestions, imagesQuestion, buildOpenModal, readOpenModal,
  checkEligibility, solvedTagOf, tagChoices, findTag, missingPermissions, parseSetting, clip,
};
