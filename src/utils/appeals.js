const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder, FileBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  PermissionFlagsBits, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const db = require('../db/appeals');
// Loaded when used: it needs the PostgreSQL pool, and the checks of this module run without one.
const filesDb = new Proxy({}, { get: (_target, name) => require('../db/appealFiles')[name] });
const { ACCEPT_KEYS, MAX_FILES_LIMIT } = require('./appealFile');
const { textCard } = require('./caseCard');
const logger = require('./logger');
const { t, guildLanguage, normalizeLanguage, currentLanguage, defaultText } = require('../i18n');

const PREFIX = 'appeal';
const LIMITS = { forms: 10, sections: 6, questions: 12, options: 20, label: 200, help: 300, short: 300, paragraph: 1500, number: 20, reply: 1500, greeting: 600, link: 300 };
const QUESTION_TYPES = ['short', 'paragraph', 'choice', 'multi', 'yesno', 'number', 'dropdown', 'scale', 'date', 'link', 'file', 'confirm'];
const LIST_TYPES = ['choice', 'multi', 'dropdown']; // the types that have a list of options
const clampInt = (value, min, max, fallback) => { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
const PUNISHMENT_TYPES = ['ban', 'mute', 'warn', 'kick'];
const DETAILS = ['reason', 'duration', 'moderator'];
const BLOCKS = { none: 0, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000, forever: -1 };
// What the members read when the server wrote nothing: in the language the server chose for its appeal page (English when it chose none).
const DEFAULT_MESSAGES = {
  en: {
    submitted: 'Your appeal was sent. The staff of {server} will look at it.', // i18n-ignore: default appeal text, follows the language of the appeal page
    accepted: 'Your appeal was accepted. {reason}', // i18n-ignore: default appeal text, follows the language of the appeal page
    rejected: 'Your appeal was rejected. {reason}', // i18n-ignore: default appeal text, follows the language of the appeal page
    reply: 'The staff of {server} wrote to you about your appeal.', // i18n-ignore: default appeal text, follows the language of the appeal page
  },
  es: {
    submitted: 'Tu apelación fue enviada. El staff de {server} la revisará.', // i18n-ignore: default appeal text, follows the language of the appeal page
    accepted: 'Tu apelación fue aceptada. {reason}', // i18n-ignore: default appeal text, follows the language of the appeal page
    rejected: 'Tu apelación fue rechazada. {reason}', // i18n-ignore: default appeal text, follows the language of the appeal page
    reply: 'El staff de {server} te escribió sobre tu apelación.', // i18n-ignore: default appeal text, follows the language of the appeal page
  },
  'pt-BR': {
    submitted: 'Sua apelação foi enviada. A equipe de {server} vai analisá-la.', // i18n-ignore: default appeal text, follows the language of the appeal page
    accepted: 'Sua apelação foi aceita. {reason}', // i18n-ignore: default appeal text, follows the language of the appeal page
    rejected: 'Sua apelação foi recusada. {reason}', // i18n-ignore: default appeal text, follows the language of the appeal page
    reply: 'A equipe de {server} escreveu para você sobre a sua apelação.', // i18n-ignore: default appeal text, follows the language of the appeal page
  },
};
const LABELS = { en: { rejoin: 'Rejoin', answer: 'Answer on ' }, es: { rejoin: 'Volver a entrar', answer: 'Responde en ' }, 'pt-BR': { rejoin: 'Voltar a entrar', answer: 'Responda em ' } }; // i18n-ignore: follows the language of the appeal page
const labelsFor = (config) => LABELS[config?.language] ?? LABELS.en;

const clip = (value, max) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const id = (value, fallback) => (/^[a-z0-9_-]{1,24}$/i.test(String(value ?? '')) ? String(value) : fallback);

/** Fills {username}, {user}, {server}, {reason}, {form} and {link}; what a message does not use is left out. */
function renderTemplate(text, vars) {
  return String(text ?? '').replace(/\{(username|user|server|reason|form|link)\}/g, (_m, key) => String(vars?.[key] ?? '')).replace(/[ \t]+\n/g, '\n').trim();
}

function messageFor(config, form, key) {
  return clip(form?.messages?.[key] || config?.messages?.[key] || (DEFAULT_MESSAGES[config?.language] ?? DEFAULT_MESSAGES.en)[key], 1000);
}

/** A form as the dashboard sends it, cut down to what is allowed: limits, types and ids all checked. */
function normalizeForm(input) {
  const form = {
    name: clip(input?.name, 80) || 'Untitled form', // i18n-ignore: stored default of a dashboard form, shown on the website
    icon: clip(input?.icon, 60) || null,
    short_description: clip(input?.short_description, 160) || null,
    description: clip(input?.description, 1500) || null,
    status: input?.status === 'live' ? 'live' : 'draft',
    requirement_types: [...new Set((Array.isArray(input?.requirement_types) ? input.requirement_types : []).filter((t) => PUNISHMENT_TYPES.includes(t)))],
    block_on_reject: Object.hasOwn(BLOCKS, input?.block_on_reject) ? input.block_on_reject : 'none',
    generate_invite: input?.generate_invite === true,
    messages: {},
    sections: [],
  };
  for (const key of ['submitted', 'accepted', 'rejected']) {
    const text = clip(input?.messages?.[key], 1000);
    if (text) form.messages[key] = text;
  }
  const seen = new Set();
  const unique = (raw, prefix, index) => { let value = id(raw, `${prefix}${index + 1}`); while (seen.has(value)) value = `${value}x`; seen.add(value); return value; };
  for (const [si, section] of (Array.isArray(input?.sections) ? input.sections : []).slice(0, LIMITS.sections).entries()) {
    // i18n-ignore: stored default of a dashboard form, shown on the website
    const clean = { id: unique(section?.id, 's', si), title: clip(section?.title, 100) || `Section ${si + 1}`, description: clip(section?.description, 500) || null, questions: [] };
    for (const [qi, question] of (Array.isArray(section?.questions) ? section.questions : []).slice(0, LIMITS.questions).entries()) {
      const type = QUESTION_TYPES.includes(question?.type) ? question.type : 'short';
      const label = clip(question?.label, LIMITS.label);
      if (!label) continue;
      const options = LIST_TYPES.includes(type) ? [...new Set((Array.isArray(question?.options) ? question.options : []).map((o) => clip(o, 100)).filter(Boolean))].slice(0, LIMITS.options) : [];
      if (LIST_TYPES.includes(type) && options.length < 2) continue;
      clean.questions.push({
        id: unique(question?.id, 'q', qi), type, label, help: clip(question?.help, LIMITS.help) || null, required: question?.required !== false, options,
        // A scale goes from 1 to `max`; a file question says what it takes and how many files.
        ...(type === 'scale' ? { max: clampInt(question?.max, 3, 10, 5) } : {}),
        ...(type === 'file' ? { accept: ACCEPT_KEYS.includes(question?.accept) ? question.accept : 'images', max_files: clampInt(question?.max_files, 1, MAX_FILES_LIMIT, 3) } : {}),
      });
    }
    form.sections.push(clean);
  }
  return form;
}

/**
 * The answers of a person checked against the form. `files` is what is known about the files the person uploaded (id -> row), already checked
 * to be theirs, for this form and not sent before. Returns { ok, answers: [{ id, label, type, value }], errors: { questionId: code } }.
 */
function validateAnswers(form, raw, files = {}) {
  const answers = [];
  const errors = {};
  for (const section of form?.sections ?? []) {
    for (const q of section.questions ?? []) {
      let value = raw?.[q.id];
      const empty = value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0);
      if (empty) { if (q.required) errors[q.id] = 'required'; continue; }
      if (q.type === 'multi') {
        value = (Array.isArray(value) ? value : [value]).map(String);
        if (value.some((v) => !q.options.includes(v))) { errors[q.id] = 'invalid'; continue; }
        value = [...new Set(value)];
      } else if (q.type === 'choice' || q.type === 'dropdown') {
        value = String(value);
        if (!q.options.includes(value)) { errors[q.id] = 'invalid'; continue; }
      } else if (q.type === 'yesno') {
        value = value === true || value === 'yes' || value === 'true' ? 'Yes' : value === false || value === 'no' || value === 'false' ? 'No' : null;
        if (!value) { errors[q.id] = 'invalid'; continue; }
      } else if (q.type === 'confirm') {
        if (!(value === true || value === 'yes' || value === 'true' || value === 'on')) { if (q.required) errors[q.id] = 'required'; continue; }
        value = 'Yes';
      } else if (q.type === 'number') {
        const text = String(value).trim();
        if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(text)) { errors[q.id] = 'invalid'; continue; }
        value = text;
      } else if (q.type === 'scale') {
        const max = clampInt(q.max, 3, 10, 5);
        const text = String(value).trim();
        if (!/^\d{1,2}$/.test(text) || Number(text) < 1 || Number(text) > max) { errors[q.id] = 'invalid'; continue; }
        value = text;
      } else if (q.type === 'date') {
        const text = String(value).trim();
        const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
        if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 2100) { errors[q.id] = 'invalid'; continue; }
        value = text;
      } else if (q.type === 'link') {
        const text = String(value).trim().slice(0, LIMITS.link);
        let url = null;
        try { url = new URL(text); } catch { /* not a link */ }
        if (!url || !['http:', 'https:'].includes(url.protocol)) { errors[q.id] = 'invalid'; continue; }
        value = url.toString().slice(0, LIMITS.link);
      } else if (q.type === 'file') {
        const ids = [...new Set((Array.isArray(value) ? value : [value]).map(String))];
        const rows = ids.map((fileId) => files[fileId]);
        if (!ids.length || rows.some((row) => !row || row.question_id !== q.id) || ids.length > clampInt(q.max_files, 1, MAX_FILES_LIMIT, 3)) { errors[q.id] = 'invalid'; continue; }
        value = rows.map((row) => ({ id: row.id, name: row.name, mime: row.mime, size: row.size }));
      } else {
        value = clip(value, q.type === 'paragraph' ? LIMITS.paragraph : LIMITS.short);
        if (!value) { if (q.required) errors[q.id] = 'required'; continue; }
      }
      answers.push({ id: q.id, label: q.label, type: q.type, value, ...(q.type === 'scale' ? { max: clampInt(q.max, 3, 10, 5) } : {}) });
    }
  }
  return { ok: Object.keys(errors).length === 0, answers, errors };
}

/** The files a person uploaded that the answers point to, checked to be theirs, of this form and not sent before. Returns id -> row. */
async function loadAnswerFiles(guildId, userId, form, rawAnswers) {
  const wanted = new Set();
  for (const section of form?.sections ?? []) {
    for (const q of section.questions ?? []) {
      if (q.type !== 'file') continue;
      const value = rawAnswers?.[q.id];
      for (const fileId of Array.isArray(value) ? value : value ? [value] : []) wanted.add(String(fileId));
    }
  }
  const known = {};
  if (!wanted.size) return known;
  for (const row of await filesDb.listLoose(guildId, userId, form.id)) if (wanted.has(row.id)) known[row.id] = row;
  return known;
}

/** What the member is shown about a punishment, cut down to what the server allows to show. */
function shapePunishment(row, config) {
  const details = new Set(config.punishment_details ?? []);
  const out = { source: row.source, type: row.type, at: row.at ?? null };
  if (details.has('reason')) out.reason = row.reason ? clip(row.reason, 400) : null;
  if (details.has('duration')) out.until = row.until ?? null;
  if (details.has('moderator')) out.moderator = row.moderator ?? null;
  return out;
}

const caseType = (type) => (['ban', 'tempban', 'hardban'].includes(type) ? 'ban' : ['mute', 'tempmute', 'jail'].includes(type) ? 'mute' : type === 'warn' ? 'warn' : type === 'kick' ? 'kick' : null);

/** The punishments a member has right now in a server (Petto cases and, when asked, what Discord itself says), as the server wants them shown. */
async function fetchPunishments(guild, userId, config) {
  const wanted = new Set(config.punishment_types ?? []);
  const rows = [];
  const useDiscord = config.punishment_source !== 'petto';
  const usePetto = config.punishment_source !== 'discord';
  if (usePetto) {
    const { getUserHistory } = require('../db/modActions');
    const history = await getUserHistory(guild.id, userId, { limit: 50 }).catch(() => []);
    const maxAge = Date.now() - (config.warns_max_age_days ?? 30) * 86_400_000;
    for (const c of history) {
      const type = caseType(c.type);
      if (!type || !wanted.has(type)) continue;
      if (c.active === false) continue;
      if (c.expires_at && Date.parse(c.expires_at) <= Date.now()) continue;
      if (type === 'warn' && Date.parse(c.created_at) < maxAge) continue;
      if (type === 'kick') continue; // a kick ends by itself, there is nothing to lift
      rows.push({ source: 'petto', type, reason: c.reason, at: c.created_at, until: c.expires_at, moderator: c.moderator_id ? `<@${c.moderator_id}>` : null, caseNumber: c.case_number });
    }
  }
  if (useDiscord) {
    if (wanted.has('ban') && !rows.some((r) => r.type === 'ban')) {
      const ban = await guild.bans.fetch({ user: userId, force: true }).catch(() => null);
      if (ban) rows.push({ source: 'discord', type: 'ban', reason: ban.reason, at: null, until: null, moderator: null });
    }
    if (wanted.has('mute') && !rows.some((r) => r.type === 'mute')) {
      const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
      const until = member?.communicationDisabledUntilTimestamp;
      if (until && until > Date.now()) rows.push({ source: 'discord', type: 'mute', reason: null, at: null, until: new Date(until).toISOString(), moderator: null });
    }
  }
  return rows;
}

/** Whether a member may open a form: the form can ask for a punishment of some type first. */
function meetsRequirement(form, punishments) {
  const need = form?.requirement_types ?? [];
  if (!need.length) return true;
  return punishments.some((p) => need.includes(p.type));
}

function blockUntil(kind, now = Date.now()) {
  const span = BLOCKS[kind] ?? 0;
  if (span === 0) return undefined;
  return span < 0 ? null : new Date(now + span).toISOString();
}

/** The address of the appeal page: the short name the server chose, or its id. */
function siteLink(guildId, slug = null) {
  return `https://petto.sbs/appeal/${slug || guildId}`;
}

const APPEAL_KIND = { ban: 'ban', tempban: 'ban', mute: 'mute', tempmute: 'mute', timeout: 'mute', warn: 'warn', kick: 'kick', softban: 'kick', jail: 'jail' };

/** The appeal page to point a sanctioned member to, or null when the server has appeals off or this sanction cannot be appealed. */
async function appealLinkFor(guildId, type) {
  const kind = APPEAL_KIND[type];
  if (!kind) return null;
  const config = await db.getConfig(guildId);
  if (!config.enabled || !(config.punishment_types ?? []).includes(kind)) return null;
  return siteLink(guildId, config.slug);
}

// The kinds of punishment and of lifted sanction, as the staff read them (the stored values stay in English).
const TYPE_KEYS = ['ban', 'tempban', 'hardban', 'softban', 'mute', 'tempmute', 'timeout', 'warn', 'kick', 'jail'];
const typeName = (type, lang) => (TYPE_KEYS.includes(type) ? t(lang, `appeals.type.${type}`) : String(type));

/** What was lifted (`ban`, `timeout`, `tempban #7`) in words of `lang`. */
function liftedText(lifted, lang) {
  return lifted.map((entry) => {
    const match = /^(\w+)( #\d+)?$/.exec(String(entry));
    return match ? `${typeName(match[1], lang)}${match[2] ?? ''}` : String(entry);
  }).join(', ');
}

// A yes/no answer is stored as `Yes` or `No`; the card shows it in the server's language. Files show their names, a scale `3 / 5`.
const answerValue = (answer, lang) => {
  if ((answer.type === 'yesno' || answer.type === 'confirm') && (answer.value === 'Yes' || answer.value === 'No')) return t(lang, answer.value === 'Yes' ? 'appeals.card.yes' : 'appeals.card.no');
  if (answer.type === 'scale') return `${answer.value} / ${answer.max ?? 5}`;
  if (answer.type === 'file') return (Array.isArray(answer.value) ? answer.value : []).map((file) => `📎 ${clip(file?.name, 80)}`).join('\n'); // i18n-ignore: a paperclip emoji
  return Array.isArray(answer.value) ? answer.value.join(', ') : String(answer.value);
};

const STATUS_COLORS = { pending: 0xfed53c, accepted: 0xa5ea7a, rejected: 0xfe6465, withdrawn: 0x4b4f59 };

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

// What Discord shows for the files of a card: up to 10 of them travel with the message while their sizes fit; the rest are read in the dashboard.
const ATTACH_MAX = 10;
const ATTACH_BUDGET = 8 * 1024 * 1024;
const attachName = (file, index) => `${index + 1}-${String(file.id).slice(0, 8)}.${file.mime.startsWith('image/') ? 'png' : file.mime === 'application/pdf' ? 'pdf' : 'txt'}`;
function planAttachments(files = []) {
  const attached = [];
  let total = 0;
  files.forEach((file, index) => {
    if (attached.length >= ATTACH_MAX || total + (file.size ?? 0) > ATTACH_BUDGET) return;
    total += file.size ?? 0;
    attached.push({ file, name: attachName(file, index) });
  });
  return { attached, extra: files.length - attached.length };
}

const dashboardUrl = (guildId) => `https://petto.sbs/dash/guild/${guildId}/appeals?section=submissions`;

/**
 * The card the staff reads in the submissions channel, in Components V2: who it is, the state, the punishments, every answer, the files
 * and the buttons. Once the appeal is answered or withdrawn the buttons stay but are locked, and the card shows who answered and when.
 * `files` are the rows of the files of the submission (without bytes); the bytes travel as attachments only when the card is first sent.
 */
function buildStaffCard({ submission, form, config, lang = currentLanguage(), files = [], pings = [], moderatorId = null }) {
  const status = submission.status ?? 'pending';
  const container = new ContainerBuilder().setAccentColor(STATUS_COLORS[status] ?? STATUS_COLORS.pending);
  const head = [
    ...(pings.length ? [pings.map((r) => `<@&${r}>`).join(' ')] : []),
    `## ${t(lang, 'appeals.card.title', { form: clip(submission.form_name || form?.name, 80) })}`,
    `<@${submission.user_id}> · \`${clip(submission.username, 60)}\` · \`${submission.user_id}\``,
    `-# ${t(lang, `appeals.card.status.${status}`)}`,
  ].join('\n');
  const header = new TextDisplayBuilder().setContent(head);
  const avatar = /^https?:\/\//i.test(String(submission.avatar_url ?? '')) ? submission.avatar_url : null;
  if (avatar) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(header).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  else container.addTextDisplayComponents(header);

  const punishments = submission.punishments ?? [];
  if (punishments.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([`### ${t(lang, 'appeals.card.punishments')}`, ...punishments.slice(0, 6).map((p) => `• ${typeName(p.type, lang)}${p.reason ? ` — ${clip(p.reason, 140)}` : ''}${p.until ? ` · ${t(lang, 'appeals.card.until', { time: `<t:${Math.floor(Date.parse(p.until) / 1000)}:f>` })}` : ''}${p.source === 'discord' ? ' (Discord)' : ''}`)].join('\n')));
  }

  // The answers, grouped so the card keeps within Discord's 4000 characters of text and its 40 components.
  const verdictText = status === 'pending' ? '' : `${t(lang, `appeals.card.${status === 'accepted' ? 'acceptedBy' : status === 'rejected' ? 'rejectedBy' : 'withdrawnBy'}`, { moderator: moderatorId ? `<@${moderatorId}>` : '', time: `<t:${Math.floor((submission.resolved_at ? Date.parse(submission.resolved_at) : Date.now()) / 1000)}:R>` })}${submission.resolution_reason && status !== 'withdrawn' ? `\n> ${clip(submission.resolution_reason, 300)}` : ''}`;
  let budget = 3400 - head.length - verdictText.length - (submission.invite_note ? 300 : 0);
  const blocks = [];
  let more = false;
  for (const a of submission.answers ?? []) {
    const block = `**${clip(a.label, 120)}**\n${clip(answerValue(a, lang), a.type === 'file' ? 500 : 700)}`;
    if (budget - block.length < 0 || blocks.length >= 24) { more = true; break; }
    budget -= block.length; blocks.push(block);
  }
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));
  for (let i = 0; i < blocks.length; i += 4) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(blocks.slice(i, i + 4).join('\n\n')));
  if (more) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`*${t(lang, 'appeals.card.moreAnswers')}*`));

  const { attached, extra } = planAttachments(files);
  const pictures = attached.filter((a) => a.file.mime.startsWith('image/'));
  const documents = attached.filter((a) => !a.file.mime.startsWith('image/'));
  if (attached.length || extra) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    if (pictures.length) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...pictures.slice(0, 10).map((a) => new MediaGalleryItemBuilder().setURL(`attachment://${a.name}`).setDescription(clip(a.file.name, 100)))));
    for (const a of documents.slice(0, 5)) container.addFileComponents(new FileBuilder().setURL(`attachment://${a.name}`));
    if (extra) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${t(lang, 'appeals.card.moreFiles', { count: extra })}`));
  }

  const footer = [];
  if (submission.invite_note) footer.push(`**${t(lang, 'appeals.card.invite')}** — ${submission.invite_url ? `${submission.invite_url} (${submission.invite_note})` : submission.invite_note}`);
  if (verdictText) footer.push(verdictText);
  footer.push(`-# ID ${submission.id}`);
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer.join('\n\n')));

  const locked = status !== 'pending';
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}::accept::${submission.id}`).setLabel(t(lang, 'appeals.card.accept.button')).setStyle(ButtonStyle.Success).setDisabled(locked),
    new ButtonBuilder().setCustomId(`${PREFIX}::reject::${submission.id}`).setLabel(t(lang, 'appeals.card.reject.button')).setStyle(ButtonStyle.Danger).setDisabled(locked),
    new ButtonBuilder().setCustomId(`${PREFIX}::reply::${submission.id}`).setLabel(t(lang, 'appeals.card.reply.button')).setStyle(ButtonStyle.Secondary).setDisabled(locked),
    new ButtonBuilder().setLabel(t(lang, 'appeals.card.dashboard.button')).setStyle(ButtonStyle.Link).setURL(dashboardUrl(submission.guild_id)),
  ));
  return { container, attached };
}

/** Sends a plain card to the people of a submission's thread or the submissions channel, never failing the caller. */
async function notifyStaff(guild, submission, text, color = 0x4b4f59) {
  const target = submission.thread_id ? await fetchChannel(guild, submission.thread_id) : await fetchChannel(guild, submission.channel_id);
  if (!target) return;
  await target.send({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch((err) => logger.warn(`Appeals: could not notify the staff: ${err.message}`));
}

async function sendDm(client, userId, text, color) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return false;
  return user.send({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 }).then(() => true).catch(() => false);
}

/** A member's appeal, from the site: checks, stores it and puts it in front of the staff. */
async function submitAppeal({ client, guild, config, form, user, rawAnswers }) {
  if (!config.enabled) return { ok: false, error: 'disabled' };
  if (!form || form.status !== 'live') return { ok: false, error: 'form_unavailable' };
  if (await db.getBlock(guild.id, user.id)) return { ok: false, error: 'blocked' };
  const punishments = (await fetchPunishments(guild, user.id, config)).map((p) => shapePunishment(p, config));
  if (!meetsRequirement(form, punishments)) return { ok: false, error: 'requirement' };
  if (await db.countPending(guild.id, user.id, form.id) > 0) return { ok: false, error: 'already_pending' };
  const checked = validateAnswers(form, rawAnswers, await loadAnswerFiles(guild.id, user.id, form, rawAnswers));
  if (!checked.ok) return { ok: false, error: 'invalid', fields: checked.errors };
  const channel = await fetchChannel(guild, config.submission_channel_id);
  if (!channel) return { ok: false, error: 'no_channel' };
  // Called from the website too, outside of any server: the staff read the card in the server's language.
  const lang = await guildLanguage(guild.id);

  const submission = await db.createSubmission({
    guild_id: guild.id, form_id: form.id, form_name: form.name, user_id: user.id, username: clip(user.username, 80),
    avatar_url: user.avatarUrl ?? null, answers: checked.answers, punishments,
  });
  // The files the answers carry are tied to the submission, and the card takes them along.
  const fileIds = checked.answers.filter((a) => a.type === 'file').flatMap((a) => a.value.map((file) => file.id));
  await filesDb.attach(guild.id, user.id, fileIds, submission.id).catch((err) => logger.warn(`Appeals: could not tie the files of ${submission.id}: ${err.message}`));
  try {
    const pings = (config.ping_role_ids ?? []).filter((r) => guild.roles.cache.has(r));
    const fileRows = fileIds.length ? await filesDb.listForSubmission(submission.id, { withBytes: true }) : [];
    const { container, attached } = buildStaffCard({ submission: { ...submission, guild_id: guild.id }, form, config, lang, files: fileRows, pings });
    const message = await channel.send({
      // A Components V2 message cannot carry `content`: the role pings go at the top of the card.
      components: [container],
      files: attached.map(({ file, name }) => new AttachmentBuilder(fileRows.find((row) => row.id === file.id).bytes, { name })),
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { roles: pings, parse: [] },
    });
    let threadId = null;
    if (config.auto_thread && channel.type === ChannelType.GuildText && message.startThread) {
      const name = renderTemplate(defaultText(lang, config.thread_name, 'appeals.threadName'), { username: user.username }).slice(0, 100) || t(lang, 'appeals.threadName', { username: user.username }).slice(0, 100);
      threadId = (await message.startThread({ name, autoArchiveDuration: 1440 }).catch(() => null))?.id ?? null;
    }
    await db.updateSubmission(submission.id, { channel_id: channel.id, message_id: message.id, thread_id: threadId });
    submission.channel_id = channel.id; submission.message_id = message.id; submission.thread_id = threadId;
  } catch (err) {
    logger.error(`Appeals: could not post submission ${submission.id}:`, err);
    await require('../db/database').from('appeal_submissions').delete().eq('id', submission.id).then(() => {}, () => {});
    return { ok: false, error: 'post_failed' };
  }
  await db.addMessage({ submission_id: submission.id, guild_id: guild.id, author_type: 'system', author_name: 'Petto', content: messageFor(config, form, 'submitted').replace(/\{server\}/g, guild.name) }).catch(() => {});
  await logLine(guild, config, t(lang, 'appeals.log.sent', { user: clip(user.username, 40), form: clip(form.name, 60) }), STATUS_COLORS.pending);
  return { ok: true, submission };
}

async function logLine(guild, config, text, color) {
  const channel = await fetchChannel(guild, config.log_channel_id);
  if (!channel) return;
  await channel.send({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => {});
}

/**
 * The invite a member gets after an accepted appeal, and a short note on where it came from so the staff can see it:
 * the fixed code of the server, or a fresh single-use one (valid 7 days) made in a channel Petto can create invites in.
 */
async function inviteFor(guild, config, form, lang = currentLanguage()) {
  const fixed = config.rejoin_invite_code ? `https://discord.gg/${config.rejoin_invite_code}` : null;
  const wantsNew = Boolean(config.auto_invite || form?.generate_invite);
  if (!wantsNew) return fixed ? { url: fixed, note: t(lang, 'appeals.invite.fixed') } : { url: null, note: t(lang, 'appeals.invite.none') };
  const me = guild.members.me;
  const channel = guild.channels.cache.find((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type) && me?.permissionsIn(c).has(PermissionFlagsBits.CreateInstantInvite));
  if (!channel) return { url: fixed, note: t(lang, fixed ? 'appeals.invite.noPermissionFixed' : 'appeals.invite.noPermission') };
  const invite = await channel.createInvite({ maxAge: 7 * 86_400, maxUses: 1, unique: true, reason: t(lang, 'appeals.audit.accepted') }).catch(() => null);
  if (!invite) return { url: fixed, note: t(lang, fixed ? 'appeals.invite.refusedFixed' : 'appeals.invite.refused') };
  return { url: invite.url, note: t(lang, 'appeals.invite.created', { channel: channel.name }) };
}

/** Lifts what the member was appealing: the ban and the timeout. Petto cases are lifted through the same path as the dashboard. */
async function liftPunishments(guild, submission, moderatorId, lang = currentLanguage()) {
  const reason = t(lang, 'appeals.audit.accepted');
  const done = [];
  const user = { id: moderatorId, username: moderatorId };
  const { liftSanction, isLiftable } = require('./sanctionLift');
  const { getUserHistory } = require('../db/modActions');
  const history = await getUserHistory(guild.id, submission.user_id, { limit: 50 }).catch(() => []);
  for (const row of history.filter(isLiftable)) {
    await liftSanction(guild, row.case_number, user, reason).then(() => done.push(`${row.type} #${row.case_number}`)).catch((err) => logger.warn(`Appeals: could not lift case ${row.case_number}: ${err.message}`));
  }
  if (await guild.bans.fetch({ user: submission.user_id, force: true }).catch(() => null)) {
    const { getHardBan } = require('../db/hardBans');
    if (!(await getHardBan(guild.id, submission.user_id).catch(() => null))) {
      await guild.members.unban(submission.user_id, reason).then(() => done.push('ban')).catch(() => {});
    }
  }
  const member = guild.members.cache.get(submission.user_id) ?? await guild.members.fetch(submission.user_id).catch(() => null);
  if (member?.isCommunicationDisabled?.()) await member.timeout(null, reason).then(() => done.push('timeout')).catch(() => {});
  return done;
}

/** Locks and archives the thread of a closed appeal, so nothing more is written in it. Best effort: it needs Manage Threads. */
async function closeThread(guild, submission, lang) {
  if (!submission.thread_id) return;
  const thread = guild.channels.cache.get(submission.thread_id) ?? await guild.channels.fetch(submission.thread_id).catch(() => null);
  if (!thread?.isThread?.()) return;
  const reason = t(lang, 'appeals.audit.closed');
  await thread.setLocked(true, reason).catch((err) => logger.warn(`Appeals: could not lock the thread: ${err.message}`));
  await thread.setArchived(true, reason).catch(() => {});
}

/** Accepts or rejects a pending appeal: stores it, updates the card, writes to the member and applies the form's rules. */
async function resolveAppeal({ client, guild, submission, status, moderatorId, moderatorName = null, reason = null }) {
  if (!['accepted', 'rejected'].includes(status)) return { ok: false, error: 'bad_status' };
  const row = await db.resolveSubmission(submission.id, { status, resolved_by: moderatorId, resolved_at: new Date().toISOString(), resolution_reason: clip(reason, 800) || null });
  if (!row) return { ok: false, error: 'already_resolved' };
  const config = await db.getConfig(guild.id);
  const lang = await guildLanguage(guild.id);
  const form = row.form_id ? await db.getForm(guild.id, row.form_id).catch(() => null) : null;
  const vars = { server: guild.name, reason: clip(reason, 800) || '', form: row.form_name, username: row.username, link: `${siteLink(guild.id, config.slug)}/status/${row.id}` };
  let invite = null;
  let lifted = [];
  if (status === 'accepted') {
    lifted = await liftPunishments(guild, row, moderatorId, lang);
    invite = await inviteFor(guild, config, form, lang);
    // The staff can see which invite was made, or why there is none.
    row.invite_url = invite.url; row.invite_note = invite.note;
    await db.updateSubmission(row.id, { invite_url: invite.url, invite_note: invite.note }).catch(() => {});
  } else if (form?.block_on_reject && form.block_on_reject !== 'none') {
    await db.setBlock(guild.id, row.user_id, blockUntil(form.block_on_reject), t(lang, 'appeals.audit.rejected')).catch(() => {});
  }
  const text = `${renderTemplate(messageFor(config, form, status), vars)}${invite?.url ? `\n\n${labelsFor(config).rejoin}: ${invite.url}` : ''}\n\n-# ${siteLink(guild.id, config.slug)}/status/${row.id}`;
  const dm = await sendDm(client, row.user_id, text, STATUS_COLORS[status]);
  await db.addMessage({ submission_id: row.id, guild_id: guild.id, author_type: 'system', author_name: 'Petto', content: renderTemplate(messageFor(config, form, status), vars) + (invite?.url ? `\n${invite.url}` : '') }).catch(() => {});
  await updateStaffCard(guild, row, form, config, moderatorId, lang);
  const who = moderatorName ?? `<@${moderatorId}>`;
  const liftedPart = lifted.length ? t(lang, 'appeals.log.lifted', { lifted: liftedText(lifted, lang) }) : '';
  const invitePart = row.invite_note ? t(lang, 'appeals.log.invite', { invite: row.invite_url ? `${row.invite_url} (${row.invite_note})` : row.invite_note }) : '';
  await logLine(guild, config, t(lang, `appeals.log.${status}`, { moderator: who, user: clip(row.username, 40), lifted: liftedPart, invite: invitePart }), STATUS_COLORS[status]);
  await closeThread(guild, row, lang);
  return { ok: true, submission: row, dm, invite, lifted };
}

async function updateStaffCard(guild, row, form, config, moderatorId, lang = currentLanguage()) {
  const channel = await fetchChannel(guild, row.channel_id);
  if (!channel || !row.message_id) return;
  const message = await channel.messages.fetch(row.message_id).catch(() => null);
  if (!message) return;
  const files = await filesDb.listForSubmission(row.id).catch(() => []);
  // The files already travel with the message: the card only points at them again, and its buttons are locked.
  const { container } = buildStaffCard({ submission: { ...row, guild_id: guild.id }, form, config, lang, files, moderatorId });
  await message.edit({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => {});
}

/** A message from the staff to the member (and the DM that tells them), from the card or from the dashboard. */
async function staffReply({ client, guild, submission, content, moderatorId, moderatorName }) {
  const text = clip(content, LIMITS.reply);
  if (!text) return { ok: false, error: 'empty' };
  const config = await db.getConfig(guild.id);
  const anonymous = Boolean(config.anonymous_messages);
  await db.addMessage({ submission_id: submission.id, guild_id: guild.id, author_type: 'staff', author_id: moderatorId, author_name: moderatorName ?? null, content: text, anonymous });
  const form = submission.form_id ? await db.getForm(guild.id, submission.form_id).catch(() => null) : null;
  // The DM follows the language of the appeal page, like the default texts and labels around it.
  const staffName = t(normalizeLanguage(config?.language) ?? 'en', 'appeals.dm.staff');
  const dm = await sendDm(client, submission.user_id, `${renderTemplate(messageFor(config, form, 'reply'), { server: guild.name })}\n\n**${anonymous ? staffName : clip(moderatorName ?? staffName, 40)}**\n${text}\n\n-# ${config.allow_replies ? labelsFor(config).answer : ''}${siteLink(guild.id, config.slug)}/status/${submission.id}`, 0x8c7cff);
  const lang = await guildLanguage(guild.id);
  await notifyStaff(guild, submission, `${t(lang, 'appeals.staff.replied', { moderator: `<@${moderatorId}>`, user: clip(submission.username, 40) })}\n> ${text.slice(0, 400)}`, 0x8c7cff);
  return { ok: true, dm };
}

/** A message from the member, from the site: kept and shown to the staff where the appeal is. */
async function userReply({ guild, config, submission, content }) {
  if (!config.allow_replies) return { ok: false, error: 'replies_off' };
  if (submission.status !== 'pending') return { ok: false, error: 'closed' };
  const text = clip(content, LIMITS.reply);
  if (!text) return { ok: false, error: 'empty' };
  await db.addMessage({ submission_id: submission.id, guild_id: guild.id, author_type: 'user', author_id: submission.user_id, author_name: submission.username, content: text });
  const lang = await guildLanguage(guild.id);
  await notifyStaff(guild, submission, `${t(lang, 'appeals.staff.memberWrote', { user: clip(submission.username, 40) })}\n> ${text.slice(0, 600)}`, 0xfed53c);
  return { ok: true };
}

async function withdrawAppeal({ guild, config, submission }) {
  const row = await db.resolveSubmission(submission.id, { status: 'withdrawn', resolved_by: submission.user_id, resolved_at: new Date().toISOString() });
  if (!row) return { ok: false, error: 'already_resolved' };
  const form = row.form_id ? await db.getForm(guild.id, row.form_id).catch(() => null) : null;
  const lang = await guildLanguage(guild.id);
  await updateStaffCard(guild, { ...row, resolution_reason: t(lang, 'appeals.card.withdrawn') }, form, config, row.user_id, lang);
  await logLine(guild, config, t(lang, 'appeals.log.withdrawn', { user: clip(row.username, 40) }), STATUS_COLORS.withdrawn);
  await closeThread(guild, row, lang);
  return { ok: true };
}

/** Removes resolved submissions kept longer than each server asked. */
// How long a link name stays with a server that stopped using it. Appeals off and untouched, or on without a single appeal.
const NAME_OFF_DAYS = 30;
const NAME_IDLE_DAYS = 90;
const GONE_CODES = new Set([10004, 50001]); // Unknown Guild, Missing Access: Petto is not in that server anymore.

/** Frees the link names of servers that left Petto, switched appeals off for a month, or got no appeal in three months. The server id link keeps working. */
async function releaseIdleNames(client, now = Date.now()) {
  const freed = [];
  for (const row of await db.listNamed()) {
    let reason = null;
    if (client?.isReady?.() && client.guilds.cache.size > 0 && !client.guilds.cache.has(row.guild_id)) {
      try { await client.guilds.fetch(row.guild_id); } catch (err) { if (GONE_CODES.has(err?.code)) reason = 'left'; }
    }
    const touched = Date.parse(row.updated_at) || now;
    if (!reason && !row.enabled && now - touched > NAME_OFF_DAYS * 86_400_000) reason = 'off';
    if (!reason && row.enabled && now - touched > NAME_IDLE_DAYS * 86_400_000) {
      const last = Date.parse(await db.lastSubmissionAt(row.guild_id).catch(() => null) ?? '') || 0;
      if (now - last > NAME_IDLE_DAYS * 86_400_000) reason = 'idle';
    }
    if (!reason) continue;
    try { await db.clearSlug(row.guild_id); freed.push({ guildId: row.guild_id, slug: row.slug, reason }); } catch (err) { logger.warn(`Appeals: could not free the name ${row.slug}: ${err.message}`); }
  }
  return freed;
}

async function cleanup() {
  // Files uploaded for a form that was never sent.
  await filesDb.deleteLooseBefore(new Date(Date.now() - 24 * 3_600_000).toISOString()).catch(() => 0);
  const configs = await db.listEnabledConfigs();
  let removed = 0;
  for (const { guild_id: guildId, store_days: days } of configs) {
    removed += await db.deleteResolvedBefore(guildId, new Date(Date.now() - (days ?? 7) * 86_400_000).toISOString()).catch(() => 0);
  }
  await db.deleteExpiredReservations(new Date().toISOString()).catch(() => 0);
  return removed;
}

module.exports = {
  PREFIX, LIMITS, QUESTION_TYPES, PUNISHMENT_TYPES, DETAILS, BLOCKS, DEFAULT_MESSAGES,
  renderTemplate, messageFor, normalizeForm, validateAnswers, shapePunishment, fetchPunishments, meetsRequirement, blockUntil, siteLink, appealLinkFor, releaseIdleNames,
  buildStaffCard, planAttachments, loadAnswerFiles, liftedText, submitAppeal, resolveAppeal, staffReply, userReply, withdrawAppeal, cleanup,
};
