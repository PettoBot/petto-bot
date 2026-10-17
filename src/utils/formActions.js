// Forms (applications): what happens in Discord. A submission is stored and put in front of the staff, a review gives or takes roles
// and tells the member, a panel is posted, a thread is opened for the staff to talk about a submission, and the log hears about it.
const { AttachmentBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const formsDb = require('../db/forms');
const forms = require('./forms');
const { reviewCard, panelCard, withPanelRows } = require('./formCards');
const { textCard } = require('./caseCard');
const logger = require('./logger');
const { t, guildLanguage, currentLanguage } = require('../i18n');

// Loaded when used: they read the database and the message engine, which the checks of this module replace.
const lazy = (path) => new Proxy({}, { get: (_target, name) => require(path)[name] });
const templates = lazy('./templatedMessage');
const variables = lazy('./embedVariables');
const logEngine = lazy('../logging/engine');

const { clip, COLORS } = forms;

/** How many submissions a server keeps: the same for every server. */
async function storageCap(guildId) {
  void guildId;
  return forms.FORM_LIMITS.submissions;
}

async function fetchTextChannel(guild, channelId) {
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function fetchMember(guild, userId) {
  return guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
}

/** The variables of a form for saved embeds and messages: {form.name}, {form.title}, {form.number}, {form.status}, {form.reason}. */
function formVars(form, submission, lang) {
  const status = submission?.status ?? 'pending';
  return { name: form?.name ?? submission?.form_name ?? '', title: form?.title ?? submission?.form_title ?? '', number: submission?.number != null ? String(submission.number) : '', status: t(lang, `forms.status.${status}`), reason: submission?.reason ?? '' };
}

/** Writes a line in the `forms` category of the log. Never fails the caller. */
async function logForm(client, guild, { title, description, color, userId = null, fields = [] }) {
  try {
    const lang = await guildLanguage(guild.id);
    await logEngine.sendLog(client, guild.id, 'forms', {
      author: { name: title },
      description,
      color,
      fields,
      footer: { text: userId ? t(lang, 'forms.log.footer', { id: userId }) : t(lang, 'forms.log.footerPlain') },
      timestamp: new Date().toISOString(),
    }, { ignoreIds: userId ? [userId] : [] });
  } catch (err) {
    logger.warn(`Forms: could not write the log: ${err.message}`);
  }
}

/**
 * Stores what a member sent and puts the card in the review channel. `answers` are the collected answers. The rules of the form were
 * checked when it was opened and are checked again here, because a member can take their time between the pages.
 * Returns { ok, submission } or { ok: false, error, refusal }.
 */
async function submitForm({ client, guild, form, member, answers }) {
  const lang = await guildLanguage(guild.id);
  const [stats, total] = await Promise.all([formsDb.memberStats(guild.id, form.id, member.id), form.max_total > 0 ? formsDb.countFormSubmissions(guild.id, form.id) : 0]);
  const refusal = forms.checkEligibility(form, member, stats, { total });
  if (refusal) return { ok: false, error: 'refused', refusal };
  if (forms.missingRequired(form, answers).length) return { ok: false, error: 'missing' };
  const channel = await fetchTextChannel(guild, form.review_channel_id);
  if (!channel) return { ok: false, error: 'no_channel' };
  // Each plan keeps a number of submissions per server: the oldest reviewed ones make room, pending ones never do.
  const cap = await storageCap(guild.id);
  let stored = await formsDb.countStored(guild.id);
  if (stored.total >= cap) {
    await formsDb.trimOldest(guild.id, cap - 1);
    stored = await formsDb.countStored(guild.id);
    if (stored.total >= cap) return { ok: false, error: 'full' };
  }
  const user = member.user ?? member;
  const submission = await formsDb.createSubmission({
    guild_id: guild.id, form_id: form.id, form_name: form.name, form_title: form.title, user_id: member.id,
    username: clip(user.username ?? member.displayName, 80), avatar_url: user.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null, answers,
  });
  try {
    const pings = (form.ping_role_ids ?? []).filter((id) => guild.roles.cache.has(id));
    const { container, file } = reviewCard({ submission: { ...submission, guild_id: guild.id }, form, lang, pings, member });
    const message = await channel.send({
      components: [container],
      files: file ? [new AttachmentBuilder(Buffer.from(forms.answersAsText(submission, lang), 'utf8'), { name: file.name })] : [],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { roles: pings, parse: [] },
    });
    let threadId = null;
    if (form.auto_thread) threadId = (await startThread(message, submission, lang))?.id ?? null;
    const saved = await formsDb.updateSubmission(guild.id, submission.number, { channel_id: channel.id, message_id: message.id, thread_id: threadId });
    Object.assign(submission, saved ?? { channel_id: channel.id, message_id: message.id, thread_id: threadId });
  } catch (err) {
    logger.warn(`Forms: could not post submission #${submission.number} in ${guild.id}: ${err.message}`);
    await formsDb.updateSubmission(guild.id, submission.number, { status: 'cancelled' }).catch(() => null);
    return { ok: false, error: 'post_failed' };
  }
  await logForm(client, guild, {
    title: t(lang, 'forms.log.sent.title'),
    description: t(lang, 'forms.log.sent.description', { user: `<@${member.id}>`, form: form.title, number: submission.number }),
    color: COLORS.pending,
    userId: member.id,
    fields: [{ name: t(lang, 'forms.log.card'), value: `https://discord.com/channels/${guild.id}/${submission.channel_id}/${submission.message_id}`, inline: false }],
  });
  return { ok: true, submission };
}

/** What the member reads after sending a form: the form's own text, or the default. */
async function submittedText(guild, form, submission, member, lang = currentLanguage()) {
  const own = form.messages?.submitted?.text;
  const text = own ? forms.fillShortcuts(own, { form: form.title, number: submission.number, server: guild.name, status: t(lang, 'forms.status.pending'), reason: '' }) : t(lang, 'forms.submitted', { form: form.title, number: submission.number });
  return clip(await variables.resolve(text, { guild, member, user: member.user, form: formVars(form, submission, lang), lang }), 2000);
}

async function startThread(message, submission, lang) {
  if (!message?.startThread) return null;
  const name = clip(t(lang, 'forms.threadName', { number: submission.number, user: submission.username }), 100);
  return message.startThread({ name, autoArchiveDuration: 1440 }).catch((err) => { logger.warn(`Forms: could not open a thread: ${err.message}`); return null; });
}

/** Gives and takes roles after a review. Roles Petto cannot manage (above its own, managed by an app, gone) are reported, not tried. */
async function applyRoles(guild, userId, { add = [], remove = [] }, reason) {
  const result = { added: [], removed: [], failed: [], left: false };
  if (!add.length && !remove.length) return result;
  const member = await fetchMember(guild, userId);
  if (!member) { result.left = true; return result; }
  const top = guild.members.me?.roles?.highest?.position ?? 0;
  const canManage = Boolean(guild.members.me?.permissions?.has?.(PermissionFlagsBits.ManageRoles));
  const usable = (id) => {
    const role = guild.roles.cache.get(id);
    return role && !role.managed && role.id !== guild.id && canManage && role.position < top ? role : null;
  };
  for (const id of add) {
    if (member.roles.cache.has(id)) continue;
    const role = usable(id);
    if (!role) { result.failed.push(id); continue; }
    await member.roles.add(role, reason).then(() => result.added.push(id), () => result.failed.push(id));
  }
  for (const id of remove) {
    if (!member.roles.cache.has(id)) continue;
    const role = usable(id);
    if (!role) { result.failed.push(id); continue; }
    await member.roles.remove(role, reason).then(() => result.removed.push(id), () => result.failed.push(id));
  }
  return result;
}

/** The DM with the result: the form's saved embed, its own text, or the default. Returns whether it reached the member. */
async function sendResult(client, guild, form, submission, lang) {
  const user = await client.users.fetch(submission.user_id).catch(() => null);
  if (!user) return false;
  const member = guild.members.cache.get(submission.user_id) ?? null;
  const key = submission.status === 'accepted' ? 'accepted' : 'denied';
  const own = form?.messages?.[key] ?? {};
  const vars = { form: form?.title ?? submission.form_title, reason: submission.reason ?? '', number: submission.number, server: guild.name, status: t(lang, `forms.status.${submission.status}`) };
  const ctx = { guild, member, user, form: formVars(form, submission, lang), lang };
  if (own.template) {
    const payload = await templates.templatePayload(guild.id, own.template, ctx);
    if (payload) {
      const { reactions: _reactions, ...message } = payload;
      return user.send({ ...message, allowedMentions: { parse: [] } }).then(() => true, () => false);
    }
  }
  const base = own.text ? forms.fillShortcuts(own.text, vars) : t(lang, `forms.result.${key}`, { form: vars.form, server: guild.name, number: submission.number });
  const reasonLine = !own.text && submission.reason ? `\n> ${clip(submission.reason, 800).replace(/\n/g, '\n> ')}` : '';
  const text = clip(await variables.resolve(`${base}${reasonLine}`, ctx), 3800);
  return user.send({ components: [textCard(text, COLORS[submission.status])], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).then(() => true, () => false);
}

/** Redraws the review card of a submission (after a review, or when its thread was opened). */
async function refreshCard(guild, submission, form, lang) {
  const channel = await fetchTextChannel(guild, submission.channel_id);
  const message = channel && submission.message_id ? await channel.messages.fetch(submission.message_id).catch(() => null) : null;
  if (!message) return false;
  const member = guild.members.cache.get(submission.user_id) ?? null;
  const fileName = [...(message.attachments?.values?.() ?? [])].find((a) => /\.txt$/i.test(a.name ?? ''))?.name ?? null;
  const { container } = reviewCard({ submission: { ...submission, guild_id: guild.id }, form, lang, member, fileName });
  await message.edit({ components: [container], flags: MessageFlags.IsComponentsV2, attachments: [...(message.attachments?.values?.() ?? [])], allowedMentions: { parse: [] } }).catch((err) => logger.warn(`Forms: could not update the card of #${submission.number}: ${err.message}`));
  return true;
}

/**
 * Accepts or denies a pending submission: stores it, gives and takes the form's roles, tells the member, updates the card and logs
 * it. `reviewer` is { id, name }. Returns { ok, submission, roles, dm } or { ok: false, error } (already, bad_status).
 */
async function reviewSubmission({ client, guild, submission, status, reviewer, reason = null }) {
  if (!['accepted', 'denied'].includes(status)) return { ok: false, error: 'bad_status' };
  const lang = await guildLanguage(guild.id);
  const row = await formsDb.resolveSubmission(guild.id, submission.number, {
    status, reviewer_id: reviewer.id, reviewer_name: clip(reviewer.name, 80) || null, reason: clip(reason, forms.LIMITS.reason) || null, reviewed_at: new Date().toISOString(),
  });
  if (!row) return { ok: false, error: 'already' };
  const form = row.form_id ? await formsDb.getForm(guild.id, row.form_id).catch(() => null) : null;
  const audit = t(lang, status === 'accepted' ? 'forms.audit.accepted' : 'forms.audit.denied', { number: row.number });
  const roles = form
    ? await applyRoles(guild, row.user_id, status === 'accepted'
      ? { add: form.accept_add_role_ids ?? [], remove: form.accept_remove_role_ids ?? [] }
      : { add: form.deny_add_role_ids ?? [], remove: form.deny_remove_role_ids ?? [] }, audit)
    : { added: [], removed: [], failed: [], left: false };
  const dm = form?.dm_results === false ? null : await sendResult(client, guild, form, row, lang).catch(() => false);
  const updated = await formsDb.updateSubmission(guild.id, row.number, { role_changes: roles, dm_sent: dm }).catch(() => null) ?? { ...row, role_changes: roles, dm_sent: dm };
  await refreshCard(guild, updated, form, lang);
  await logForm(client, guild, {
    title: t(lang, `forms.log.${status}.title`),
    description: t(lang, `forms.log.${status}.description`, { user: `<@${row.user_id}>`, form: row.form_title || row.form_name, number: row.number, reviewer: `<@${reviewer.id}>` }),
    color: COLORS[status],
    userId: row.user_id,
    fields: row.reason ? [{ name: t(lang, 'forms.log.reason'), value: clip(row.reason, 1000), inline: false }] : [],
  });
  return { ok: true, submission: updated, roles, dm };
}

/** Opens (or finds) the thread under the card of a submission, for the staff to talk about it. Returns { ok, thread } or { ok: false, error }. */
async function openThread(guild, submission) {
  const lang = await guildLanguage(guild.id);
  if (submission.thread_id) {
    const existing = guild.channels.cache.get(submission.thread_id) ?? await guild.channels.fetch(submission.thread_id).catch(() => null);
    if (existing) return { ok: true, thread: existing, existed: true };
  }
  const channel = await fetchTextChannel(guild, submission.channel_id);
  if (!channel) return { ok: false, error: 'no_channel' };
  const message = submission.message_id ? await channel.messages.fetch(submission.message_id).catch(() => null) : null;
  if (!message) return { ok: false, error: 'no_card' };
  const thread = await startThread(message, submission, lang);
  if (!thread) return { ok: false, error: 'no_thread' };
  const updated = await formsDb.updateSubmission(guild.id, submission.number, { thread_id: thread.id }).catch(() => null) ?? { ...submission, thread_id: thread.id };
  const form = updated.form_id ? await formsDb.getForm(guild.id, updated.form_id).catch(() => null) : null;
  await refreshCard(guild, updated, form, lang);
  return { ok: true, thread };
}

/**
 * Posts a panel that opens `formList` in `channel`: the server's saved embed (`template`) with the buttons under it, or Petto's card.
 * Returns { ok, panel, message } or { ok: false, error } (no_forms, too_many, no_channel, no_permission, no_template, send_failed).
 */
async function postPanel({ guild, channel, formList, style = 'buttons', template = null, title = null, description = null, color = null, createdBy = null }) {
  const lang = await guildLanguage(guild.id);
  if (!formList.length) return { ok: false, error: 'no_forms' };
  if (formList.length > 25) return { ok: false, error: 'too_many' };
  if (!channel?.isTextBased?.() || !channel.send) return { ok: false, error: 'no_channel' };
  const me = guild.members.me;
  const allowed = me && channel.permissionsFor?.(me);
  if (allowed && !(allowed.has(PermissionFlagsBits.ViewChannel) && allowed.has(PermissionFlagsBits.SendMessages))) return { ok: false, error: 'no_permission' };
  const shape = style === 'select' ? 'select' : 'buttons';
  const panel = await formsDb.createPanel(guild.id, { channel_id: channel.id, form_ids: formList.map((f) => f.id), style: shape, template: clip(template, 100) || null, title: clip(title, 200) || null, description: clip(description, 2000) || null, color, created_by: createdBy });
  const options = { style: shape, panelId: panel.id, lang };
  let payload = null;
  if (panel.template) {
    const saved = await templates.templatePayload(guild.id, panel.template, { guild, lang });
    if (!saved) { await formsDb.deletePanel(guild.id, panel.id).catch(() => null); return { ok: false, error: 'no_template' }; }
    payload = withPanelRows(saved, formList, options);
  } else {
    payload = panelCard(formList, { ...options, title: panel.title, description: panel.description, color: panel.color });
  }
  const message = await channel.send(payload).catch((err) => { logger.warn(`Forms: could not post a panel in ${guild.id}: ${err.message}`); return null; });
  if (!message) { await formsDb.deletePanel(guild.id, panel.id).catch(() => null); return { ok: false, error: 'send_failed' }; }
  const saved = await formsDb.updatePanel(guild.id, panel.id, { message_id: message.id }).catch(() => null);
  return { ok: true, panel: saved ?? { ...panel, message_id: message.id }, message };
}

module.exports = { storageCap, submitForm, submittedText, reviewSubmission, applyRoles, sendResult, refreshCard, openThread, postPanel, logForm, formVars, fetchMember };
