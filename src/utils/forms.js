// Forms (applications): what a form may hold, who may open it, and how its questions become Discord forms of five questions each.
// Nothing here talks to Discord or the database; utils/formActions.js does that and the checks of scripts/check-forms.js use this.
const {
  LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits,
} = require('discord.js');
const crypto = require('node:crypto');
const { t, currentLanguage } = require('../i18n');

const PREFIX = 'fm:';
const QUESTION_TYPES = ['short', 'paragraph', 'number', 'yesno', 'choice', 'multi'];
const CHOICE_TYPES = ['choice', 'multi'];
const TEXT_TYPES = ['short', 'paragraph', 'number'];
const STATUSES = ['pending', 'accepted', 'denied', 'cancelled'];
const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'];
// The background of the web page of a form: Petto's own, or a solid tint or a gradient made from the color of the form. `aurora` and
// `waves` move slowly behind the page (only CSS, still for visitors who ask for less motion); they are a Premium touch, and a page
// whose server no longer has Premium shows the plain gradient instead.
const PAGE_BACKGROUNDS = ['default', 'solid', 'gradient', 'aurora', 'waves'];
const PREMIUM_PAGE_BACKGROUNDS = ['aurora', 'waves'];
// What Discord allows: 45 characters for the title of a form and the label of a field, 100 for its description and placeholder,
// 25 options of 100 characters in a menu, 4000 characters in a text field, and five fields in a form.
const LIMITS = {
  title: 45, label: 45, help: 100, placeholder: 100, option: 100, options: 25, description: 1000, questionDescription: 1000, image: 500,
  short: 1000, paragraph: 4000, pageSize: 5, questions: 25, reason: 1000, message: 2000, buttonLabel: 80, roles: 25,
  embedTitle: 90, embedDescription: 240,
};
// One limit for every server: forms are not a Premium module.
const FORM_LIMITS = { forms: 25, questions: 25, submissions: 2000 };
const DEFAULT_MAX = { short: 200, paragraph: 1000 };
const SNOWFLAKE = /^\d{15,25}$/;
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
// Only an answer has a color: accepted is green and denied is red.
const COLORS = { pending: null, accepted: 0xa5ea7a, denied: 0xfe6465, cancelled: null };

const clip = (value, max) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const whole = (value, min, max, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const ids = (list, max = LIMITS.roles) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((id) => SNOWFLAKE.test(id)))].slice(0, max);

/** A longer text that keeps its lines (the description of a question): at most two empty lines in a row. */
const clipText = (value, max) => String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp)$/i;
/**
 * The link of an image for a question or the banner of the page, or null when it is not one Petto shows: an https link with the
 * usual checks of a link a server owner types (utils/safeImage.js: no user, no other port, no private address), a public name (not
 * an address of numbers, not localhost or a name only inside a network, the same as the website's imageUrl) and a .png, .jpg, .gif
 * or .webp file.
 */
function imageUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > LIMITS.image) return null;
  try {
    const url = require('./safeImage').checkUrl(text);
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || host === 'localhost' || /\.(?:localhost|local|internal)$/.test(host)) return null;
    // The link as stored (a space becomes %20) still fits in the 500 characters of the database.
    return IMAGE_PATH.test(url.pathname) && url.toString().length <= LIMITS.image ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A description as plain text: without the marks of bold, italics and links, on one line. */
function plainDescription(text) {
  return String(text ?? '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/\s+/g, ' ').trim();
}

/** The line under a question in Discord (100 characters): its help line, or else the start of its description. */
function labelDescription(question) {
  if (question?.help) return clip(question.help, LIMITS.help);
  const plain = plainDescription(question?.description);
  if (!plain) return null;
  return plain.length <= LIMITS.help ? plain : `${plain.slice(0, LIMITS.help - 1).trimEnd()}…`;
}

/** A name for commands: `Staff Apps!` -> `staff-apps`. Empty when nothing usable is left. */
function slugName(value) {
  return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 32);
}

/** One question, cut down to what Discord and Petto allow, or null when it cannot be asked (no label, a list with fewer than two options). */
function normalizeQuestion(input, index = 0, seen = new Set()) {
  const type = QUESTION_TYPES.includes(input?.type) ? input.type : 'short';
  const label = clip(input?.label, LIMITS.label);
  if (!label) return null;
  let id = /^[a-z0-9_-]{1,20}$/i.test(String(input?.id ?? '')) ? String(input.id) : `q${index + 1}`;
  while (seen.has(id)) id = `${id.slice(0, 18)}${seen.size}`;
  seen.add(id);
  const question = {
    id, type, label,
    help: clip(input?.help, LIMITS.help) || null,
    description: clipText(input?.description, LIMITS.questionDescription) || null,
    image: imageUrl(input?.image),
    placeholder: clip(input?.placeholder, LIMITS.placeholder) || null,
    required: input?.required !== false,
  };
  if (type === 'short' || type === 'paragraph') {
    const cap = LIMITS[type];
    const max = whole(input?.max_length, 1, cap, DEFAULT_MAX[type]);
    question.max_length = max;
    question.min_length = Math.min(whole(input?.min_length, 0, cap, 0), max);
  }
  if (type === 'number') {
    let min = finite(input?.min_value);
    let max = finite(input?.max_value);
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    question.min_value = min;
    question.max_value = max;
  }
  if (CHOICE_TYPES.includes(type)) {
    const options = [...new Set((Array.isArray(input?.options) ? input.options : String(input?.options ?? '').split(/\r?\n|\|/)).map((o) => clip(o, LIMITS.option)).filter(Boolean))].slice(0, LIMITS.options);
    if (options.length < 2) return null;
    question.options = options;
    if (type === 'multi') question.max_choices = whole(input?.max_choices, 1, options.length, options.length);
  }
  return question;
}

/** The questions of a form, checked again (they may come from the dashboard or an older version). */
function normalizeQuestions(list, max = LIMITS.questions) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((q, i) => normalizeQuestion(q, i, seen)).filter(Boolean).slice(0, max);
}

const cleanMessage = (input) => {
  const out = {};
  const text = clip(input?.text, LIMITS.message);
  const template = clip(input?.template, 100);
  if (text) out.text = text;
  if (template) out.template = template;
  return out;
};

/** The settings of a form as they are stored, from what a command or the dashboard gives. Unknown fields are dropped. */
function normalizeForm(input, { maxQuestions = LIMITS.questions } = {}) {
  const color = finite(input?.color);
  const closes = input?.closes_at ? new Date(input.closes_at) : null;
  return {
    name: slugName(input?.name) || 'form',
    title: clip(input?.title, LIMITS.title) || clip(input?.name, LIMITS.title) || 'Form', // i18n-ignore: stored default, the server renames it
    description: clip(input?.description, LIMITS.description) || null,
    color: color !== null && color >= 0 && color <= 0xffffff ? Math.trunc(color) : null,
    status: input?.status === 'open' ? 'open' : 'closed',
    questions: normalizeQuestions(input?.questions, maxQuestions),
    review_channel_id: SNOWFLAKE.test(String(input?.review_channel_id ?? '')) ? String(input.review_channel_id) : null,
    reviewer_role_ids: ids(input?.reviewer_role_ids),
    ping_role_ids: ids(input?.ping_role_ids, 5),
    auto_thread: input?.auto_thread === true,
    required_role_ids: ids(input?.required_role_ids),
    blocked_role_ids: ids(input?.blocked_role_ids),
    min_account_days: whole(input?.min_account_days, 0, 3650, 0),
    min_member_days: whole(input?.min_member_days, 0, 3650, 0),
    one_pending: input?.one_pending !== false,
    deny_cooldown_hours: whole(input?.deny_cooldown_hours, 0, 8760, 0),
    max_per_user: whole(input?.max_per_user, 0, 1000, 0),
    max_total: whole(input?.max_total, 0, 100000, 0),
    closes_at: closes && !Number.isNaN(closes.getTime()) ? closes.toISOString() : null,
    accept_add_role_ids: ids(input?.accept_add_role_ids),
    accept_remove_role_ids: ids(input?.accept_remove_role_ids),
    deny_add_role_ids: ids(input?.deny_add_role_ids),
    deny_remove_role_ids: ids(input?.deny_remove_role_ids),
    dm_results: input?.dm_results !== false,
    messages: { submitted: cleanMessage(input?.messages?.submitted), accepted: cleanMessage(input?.messages?.accepted), denied: cleanMessage(input?.messages?.denied) },
    button_label: clip(input?.button_label, LIMITS.buttonLabel) || null,
    button_emoji: clip(input?.button_emoji, 64) || null,
    button_style: BUTTON_STYLES.includes(input?.button_style) ? input.button_style : 'primary',
    web_enabled: input?.web_enabled !== false,
    page_banner: imageUrl(input?.page_banner),
    page_background: PAGE_BACKGROUNDS.includes(input?.page_background) ? input.page_background : 'default',
    page_show_icon: input?.page_show_icon !== false,
    page_show_name: input?.page_show_name !== false,
    page_hide_branding: input?.page_hide_branding === true,
    embed_title: clip(input?.embed_title, LIMITS.embedTitle) || null,
    embed_description: clipText(input?.embed_description, LIMITS.embedDescription) || null,
    embed_image: imageUrl(input?.embed_image),
    embed_color: embedColor(input?.embed_color),
    embed_thumbnail: input?.embed_thumbnail === true,
  };
}

/** A color for the side of the link preview (0x000000 to 0xffffff), or null for the color of the form. */
function embedColor(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 0xffffff ? n : null;
}

/**
 * How the link of a form looks when it is shared in Discord or another chat (the preview of petto.sbs/form/<public id>): a title,
 * a description, an image, the color of the side and whether the image is small. Empty settings fall back on the website to the
 * title of the form and its server, its description, the banner of the page or the icon of the server, and the color of the form.
 */
function linkEmbed(form) {
  return {
    title: clip(form?.embed_title, LIMITS.embedTitle) || null,
    description: clipText(form?.embed_description, LIMITS.embedDescription) || null,
    image: imageUrl(form?.embed_image),
    color: embedColor(form?.embed_color),
    thumbnail: form?.embed_thumbnail === true,
  };
}

/**
 * How the web page of a form looks (petto.sbs/form/<public id>): the banner (an image link checked like the image of a question),
 * the background, what the header shows of the server and whether the small "Forms by Petto" line is hidden. A form saved before
 * these settings gets the defaults: no banner, Petto's background, the icon and the name of the server, the line shown.
 * `premium` is whether the server has Premium now: without it an animated background shows as the gradient and the line stays.
 */
function pageLook(form, { premium = false } = {}) {
  const background = PAGE_BACKGROUNDS.includes(form?.page_background) ? form.page_background : 'default';
  return {
    banner: imageUrl(form?.page_banner),
    background: !premium && PREMIUM_PAGE_BACKGROUNDS.includes(background) ? 'gradient' : background,
    show_icon: form?.page_show_icon !== false,
    show_name: form?.page_show_name !== false,
    hide_branding: premium && form?.page_hide_branding === true,
  };
}

/** Whether a change to a form uses a Premium look: an animated background or the "Forms by Petto" line hidden. */
function usesPremiumLook(change) {
  return PREMIUM_PAGE_BACKGROUNDS.includes(change?.page_background) || change?.page_hide_branding === true;
}

const DAY = 86_400_000;

/**
 * Whether a member may open a form now. `stats` is what they already sent ({ pending, total, lastDeniedAt }) and `total` how many
 * submissions the form has. Returns null when they may, or `{ code, vars }`: closed, ended, empty, full, blocked, roles, account,
 * member, pending, limit or cooldown.
 */
function checkEligibility(form, member, stats = {}, { total = 0, now = Date.now(), web = false } = {}) {
  if (!form || form.status !== 'open') return { code: 'closed', vars: {} };
  if (web && form.web_enabled === false) return { code: 'webOff', vars: {} };
  if (form.closes_at && Date.parse(form.closes_at) <= now) return { code: 'ended', vars: {} };
  if (!normalizeQuestions(form.questions).length) return { code: 'empty', vars: {} };
  if (form.max_total > 0 && total >= form.max_total) return { code: 'full', vars: {} };
  const roles = member?.roles?.cache;
  const has = (id) => Boolean(roles?.has?.(id));
  const blocked = (form.blocked_role_ids ?? []).find(has);
  if (blocked) return { code: 'blocked', vars: { role: `<@&${blocked}>` } };
  const required = form.required_role_ids ?? [];
  if (required.length && !required.some(has)) return { code: 'roles', vars: { roles: required.map((id) => `<@&${id}>`).join(', ') } };
  const created = member?.user?.createdTimestamp ?? null;
  if (form.min_account_days > 0 && created && now - created < form.min_account_days * DAY) {
    return { code: 'account', vars: { days: form.min_account_days, time: `<t:${Math.ceil((created + form.min_account_days * DAY) / 1000)}:R>` } };
  }
  const joined = member?.joinedTimestamp ?? null;
  if (form.min_member_days > 0 && (!joined || now - joined < form.min_member_days * DAY)) {
    const ready = (joined ?? now) + form.min_member_days * DAY;
    return { code: 'member', vars: { days: form.min_member_days, time: `<t:${Math.ceil(ready / 1000)}:R>` } };
  }
  if (form.one_pending !== false && (stats.pending ?? 0) > 0) return { code: 'pending', vars: {} };
  if (form.max_per_user > 0 && (stats.total ?? 0) >= form.max_per_user) return { code: 'limit', vars: { count: form.max_per_user } };
  if (form.deny_cooldown_hours > 0 && stats.lastDeniedAt) {
    const until = Date.parse(stats.lastDeniedAt) + form.deny_cooldown_hours * 3_600_000;
    if (until > now) return { code: 'cooldown', vars: { time: `<t:${Math.ceil(until / 1000)}:R>` } };
  }
  return null;
}

/** The sentence that tells a member why they cannot open a form. */
function refusalText(refusal, lang = currentLanguage()) {
  return t(lang, `forms.refuse.${refusal.code}`, refusal.vars);
}

/** Who may answer the submissions of a form: who manages the server, or a member of one of its reviewer roles. */
function isReviewer(member, form) {
  const permissions = member?.permissions;
  if (permissions?.has?.(PermissionFlagsBits.ManageGuild) || permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return (form?.reviewer_role_ids ?? []).some((id) => member?.roles?.cache?.has?.(id));
}

/** The questions split in the pages Discord shows: five per form. */
function pagesOf(form) {
  const questions = normalizeQuestions(form?.questions);
  const pages = [];
  for (let i = 0; i < questions.length; i += LIMITS.pageSize) pages.push(questions.slice(i, i + LIMITS.pageSize));
  return pages;
}

const fieldId = (question) => `a_${question.id}`;

/** The title of a page: the form's title, with `(2/3)` when it has more than one page, within Discord's 45 characters. */
function pageTitle(form, page, count) {
  const suffix = count > 1 ? ` (${page + 1}/${count})` : '';
  return `${clip(form.title, LIMITS.title - suffix.length) || 'Form'}${suffix}`; // i18n-ignore: fallback title
}

/** The Discord form of one page. `values` fills in what the member already wrote, when a page is shown again. */
function buildModal(form, page, { values = {}, lang = currentLanguage() } = {}) {
  const pages = pagesOf(form);
  const questions = pages[page] ?? [];
  const modal = new ModalBuilder().setCustomId(`${PREFIX}p:${form.id}:${page}`).setTitle(pageTitle(form, page, pages.length));
  for (const q of questions) {
    const label = new LabelBuilder().setLabel(q.label);
    const under = labelDescription(q);
    if (under) label.setDescription(under);
    const prior = values[q.id];
    if (TEXT_TYPES.includes(q.type)) {
      const input = new TextInputBuilder().setCustomId(fieldId(q)).setRequired(q.required)
        .setStyle(q.type === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short);
      if (q.type === 'number') {
        input.setMaxLength(30);
        const range = q.min_value !== null && q.max_value !== null ? `${q.min_value} – ${q.max_value}` : null;
        const placeholder = q.placeholder || range || t(lang, 'forms.modal.number');
        input.setPlaceholder(clip(placeholder, LIMITS.placeholder));
      } else {
        input.setMaxLength(q.max_length);
        if (q.min_length > 0) input.setMinLength(q.min_length);
        if (q.placeholder) input.setPlaceholder(q.placeholder);
      }
      if (typeof prior === 'string' && prior) input.setValue(prior.slice(0, q.type === 'number' ? 30 : q.max_length));
      label.setTextInputComponent(input);
    } else {
      const options = q.type === 'yesno'
        ? [{ label: t(lang, 'forms.answer.yes'), value: 'yes' }, { label: t(lang, 'forms.answer.no'), value: 'no' }]
        : q.options.map((option, index) => ({ label: option, value: `o${index}` }));
      const chosen = new Set(Array.isArray(prior) ? prior : prior ? [prior] : []);
      const menu = new StringSelectMenuBuilder().setCustomId(fieldId(q)).setRequired(q.required)
        .setPlaceholder(clip(q.placeholder || t(lang, q.type === 'multi' ? 'forms.modal.pickMany.menu' : 'forms.modal.pick.menu'), 150))
        .setMinValues(q.required ? 1 : 0)
        .setMaxValues(q.type === 'multi' ? (q.max_choices ?? q.options.length) : 1)
        .addOptions(options.map((option) => ({ ...option, default: chosen.has(option.value) })));
      label.setStringSelectMenuComponent(menu);
    }
    modal.addLabelComponents(label);
  }
  return modal;
}

function readField(fields, question) {
  try {
    if (TEXT_TYPES.includes(question.type)) return String(fields.getTextInputValue(fieldId(question)) ?? '');
    return [...(fields.getStringSelectValues(fieldId(question)) ?? [])].map(String);
  } catch {
    return TEXT_TYPES.includes(question.type) ? '' : [];
  }
}

/**
 * The answers of one page as the member gave them (`values`: text, or the values of the menu) and what is wrong with them
 * (`errors`: [{ id, label, code, vars }], codes required, number, range, short, invalid).
 */
function readPage(form, page, fields) {
  const values = {};
  const errors = [];
  for (const q of pagesOf(form)[page] ?? []) {
    const raw = readField(fields, q);
    const fail = (code, vars = {}) => errors.push({ id: q.id, label: q.label, code, vars });
    if (TEXT_TYPES.includes(q.type)) {
      const text = raw.trim();
      values[q.id] = text;
      if (!text) { if (q.required) fail('required'); continue; }
      if (q.type === 'number') {
        const normal = text.replace(/\s/g, '').replace(',', '.');
        if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(normal)) { fail('number'); continue; }
        const n = Number(normal);
        if ((q.min_value !== null && n < q.min_value) || (q.max_value !== null && n > q.max_value)) fail('range', { min: q.min_value ?? '…', max: q.max_value ?? '…' });
      } else if (text.length < (q.min_length ?? 0)) fail('short', { count: q.min_length });
      continue;
    }
    const allowed = q.type === 'yesno' ? ['yes', 'no'] : q.options.map((_o, i) => `o${i}`);
    const picked = [...new Set(raw)].filter((v) => allowed.includes(v));
    values[q.id] = q.type === 'multi' ? picked : (picked[0] ?? '');
    if (!picked.length) { if (q.required) fail('required'); continue; }
    if (picked.length !== raw.length || (q.type !== 'multi' && picked.length > 1) || (q.type === 'multi' && picked.length > (q.max_choices ?? q.options.length))) fail('invalid');
  }
  return { values, errors };
}

/**
 * Every page of a form at once, from plain values (the website sends `{ <question id>: text | [values] }`), with the same checks as
 * the Discord forms: { values, errors }.
 */
function readAll(form, input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const valueOf = (customId) => source[String(customId).replace(/^a_/, '')];
  const fields = {
    getTextInputValue: (customId) => { const v = valueOf(customId); return typeof v === 'string' ? v.slice(0, 5000) : ''; },
    getStringSelectValues: (customId) => { const v = valueOf(customId); return (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map(String).slice(0, 30); },
  };
  const values = {};
  const errors = [];
  pagesOf(form).forEach((_page, index) => {
    const read = readPage(form, index, fields);
    Object.assign(values, read.values);
    errors.push(...read.errors);
  });
  return { values, errors };
}

// The id of a form in its web address: 12 random letters and digits (62^12 ≈ 3·10^21), so a link cannot be guessed from another
// one and the forms of other servers cannot be walked through. The numbers stay for commands and the dashboard.
const PUBLIC_ID = /^[0-9A-Za-z]{12}$/;
const PUBLIC_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A new id for the web address of a form, like `x7Kp9QzA2mVt`. */
function newPublicId() {
  let id = '';
  for (let i = 0; i < 12; i += 1) id += PUBLIC_ID_ALPHABET[crypto.randomInt(PUBLIC_ID_ALPHABET.length)];
  return id;
}

// The language and the id of the form are both in the path (petto.sbs/es/form/x7Kp9QzA2mVt): the website draws the page of that form on
// the server, so Discord and other apps that read link previews see its title, description and image. The old addresses
// (petto.sbs/form#<id> and petto.sbs/f/<id>) still open it.
const WEB_LANG_PATH = { es: '/es', 'pt-BR': '/pt-br', pt: '/pt-br' };

/** The address of a form on the website, in a language: petto.sbs/form/<public id>, petto.sbs/es/form/…, petto.sbs/pt-br/form/…. */
function webUrl(form, lang = 'en') {
  return `https://petto.sbs${WEB_LANG_PATH[lang] ?? ''}/form/${form.public_id}`;
}

/** The link of a form to share in a chat: the same address, which carries the preview of the form (see linkEmbed). */
function shareUrl(form, lang = 'en') {
  return webUrl(form, lang);
}

/** Every answer of a form, from the values collected page by page, as it is stored: [{ id, label, type, value }]. */
function collectAnswers(form, values) {
  return normalizeQuestions(form?.questions).map((q) => {
    const raw = values?.[q.id];
    let value;
    if (q.type === 'multi') value = (Array.isArray(raw) ? raw : []).map((v) => q.options[Number(String(v).slice(1))]).filter(Boolean);
    else if (q.type === 'choice') value = q.options[Number(String(raw ?? '').slice(1))] ?? '';
    else if (q.type === 'yesno') value = raw === 'yes' || raw === 'no' ? raw : '';
    else value = clip(raw, q.type === 'paragraph' ? LIMITS.paragraph : q.type === 'number' ? 30 : LIMITS.short);
    return { id: q.id, label: q.label, type: q.type, value };
  });
}

/** Whether every required question has an answer (a last check before a submission is stored). */
function missingRequired(form, answers) {
  const byId = new Map(answers.map((a) => [a.id, a]));
  return normalizeQuestions(form?.questions).filter((q) => {
    const value = byId.get(q.id)?.value;
    return q.required && (value === undefined || value === '' || (Array.isArray(value) && !value.length));
  }).map((q) => q.label);
}

/** An answer as people read it. */
function answerText(answer, lang = currentLanguage()) {
  const value = answer?.value;
  if (Array.isArray(value)) return value.length ? value.map((v) => `• ${v}`).join('\n') : '';
  if (answer?.type === 'yesno' && (value === 'yes' || value === 'no')) return t(lang, `forms.answer.${value}`);
  return String(value ?? '');
}

/** The whole submission as plain text (the file that goes with a review card whose answers did not fit, and the dashboard export). */
function answersAsText(submission, lang = currentLanguage()) {
  const head = t(lang, 'forms.file.head', { form: submission.form_title || submission.form_name, number: submission.number, user: submission.username, id: submission.user_id });
  const body = (submission.answers ?? []).map((a) => `${a.label}\n${answerText(a, lang) || t(lang, 'forms.answer.none')}`).join('\n\n');
  return `${head}\n\n${body}\n`;
}

/**
 * Fills a message for the member: {user}, {form}, {reason}, {number}, {server} (the rest goes to the usual variables).
 * A reason left empty says nothing.
 */
function fillShortcuts(text, vars) {
  return String(text ?? '').replace(/\{(form|reason|number|server|status)\}/g, (_m, key) => String(vars?.[key] ?? '')).replace(/[ \t]+\n/g, '\n').trim();
}

/** The member's in-memory progress through the pages of a form. Kept 30 minutes, at most a few thousand at a time. */
const DRAFT_TTL_MS = 30 * 60_000;
const MAX_DRAFTS = 5000;
const drafts = new Map();
const draftKey = (guildId, userId, formId) => `${guildId}:${userId}:${formId}`;
function getDraft(guildId, userId, formId, now = Date.now()) {
  const key = draftKey(guildId, userId, formId);
  const draft = drafts.get(key);
  if (!draft) return null;
  if (now - draft.at > DRAFT_TTL_MS) { drafts.delete(key); return null; }
  return draft;
}
function saveDraft(guildId, userId, formId, values, now = Date.now()) {
  if (drafts.size >= MAX_DRAFTS) {
    for (const [key, draft] of drafts) if (now - draft.at > DRAFT_TTL_MS) drafts.delete(key);
    if (drafts.size >= MAX_DRAFTS) drafts.delete(drafts.keys().next().value);
  }
  const key = draftKey(guildId, userId, formId);
  const draft = { values: { ...(drafts.get(key)?.values ?? {}), ...values }, at: now };
  drafts.set(key, draft);
  return draft;
}
function dropDraft(guildId, userId, formId) {
  drafts.delete(draftKey(guildId, userId, formId));
}

module.exports = {
  FORM_LIMITS,
  PREFIX, QUESTION_TYPES, CHOICE_TYPES, STATUSES, BUTTON_STYLES, PAGE_BACKGROUNDS, PREMIUM_PAGE_BACKGROUNDS, LIMITS, COLORS, NAME, SNOWFLAKE,
  clip, clipText, imageUrl, plainDescription, labelDescription, slugName, normalizeQuestion, normalizeQuestions, normalizeForm, pageLook, usesPremiumLook, linkEmbed, checkEligibility, refusalText, isReviewer,
  pagesOf, pageTitle, buildModal, readPage, readAll, webUrl, shareUrl, newPublicId, PUBLIC_ID, collectAnswers, missingRequired, answerText, answersAsText, fillShortcuts,
  getDraft, saveDraft, dropDraft, DRAFT_TTL_MS,
};
