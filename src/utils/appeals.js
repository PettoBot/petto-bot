const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../db/appeals');
const { textCard } = require('./caseCard');
const logger = require('./logger');

const PREFIX = 'appeal';
const LIMITS = { forms: 10, sections: 6, questions: 12, options: 20, label: 200, help: 300, short: 300, paragraph: 1500, number: 20, reply: 1500, greeting: 600 };
const QUESTION_TYPES = ['short', 'paragraph', 'choice', 'multi', 'yesno', 'number'];
const PUNISHMENT_TYPES = ['ban', 'mute', 'warn', 'kick'];
const DETAILS = ['reason', 'duration', 'moderator'];
const BLOCKS = { none: 0, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000, forever: -1 };
// What the members read when the server wrote nothing: in the language the server chose for its appeal page (English when it chose none).
const DEFAULT_MESSAGES = {
  en: {
    submitted: 'Your appeal was sent. The staff of {server} will look at it.',
    accepted: 'Your appeal was accepted. {reason}',
    rejected: 'Your appeal was rejected. {reason}',
    reply: 'The staff of {server} wrote to you about your appeal.',
  },
  es: {
    submitted: 'Tu apelación fue enviada. El staff de {server} la revisará.',
    accepted: 'Tu apelación fue aceptada. {reason}',
    rejected: 'Tu apelación fue rechazada. {reason}',
    reply: 'El staff de {server} te escribió sobre tu apelación.',
  },
  'pt-BR': {
    submitted: 'Sua apelação foi enviada. A equipe de {server} vai analisá-la.',
    accepted: 'Sua apelação foi aceita. {reason}',
    rejected: 'Sua apelação foi recusada. {reason}',
    reply: 'A equipe de {server} escreveu para você sobre a sua apelação.',
  },
};
const LABELS = { en: { rejoin: 'Rejoin', answer: 'Answer on ' }, es: { rejoin: 'Volver a entrar', answer: 'Responde en ' }, 'pt-BR': { rejoin: 'Voltar a entrar', answer: 'Responda em ' } };
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
    name: clip(input?.name, 80) || 'Untitled form',
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
    const clean = { id: unique(section?.id, 's', si), title: clip(section?.title, 100) || `Section ${si + 1}`, description: clip(section?.description, 500) || null, questions: [] };
    for (const [qi, question] of (Array.isArray(section?.questions) ? section.questions : []).slice(0, LIMITS.questions).entries()) {
      const type = QUESTION_TYPES.includes(question?.type) ? question.type : 'short';
      const label = clip(question?.label, LIMITS.label);
      if (!label) continue;
      const options = ['choice', 'multi'].includes(type) ? [...new Set((Array.isArray(question?.options) ? question.options : []).map((o) => clip(o, 100)).filter(Boolean))].slice(0, LIMITS.options) : [];
      if (['choice', 'multi'].includes(type) && options.length < 2) continue;
      clean.questions.push({ id: unique(question?.id, 'q', qi), type, label, help: clip(question?.help, LIMITS.help) || null, required: question?.required !== false, options });
    }
    form.sections.push(clean);
  }
  return form;
}

/** The answers of a person checked against the form. Returns { ok, answers: [{ id, label, type, value }], errors: { questionId: message } }. */
function validateAnswers(form, raw) {
  const answers = [];
  const errors = {};
  for (const section of form?.sections ?? []) {
    for (const q of section.questions ?? []) {
      let value = raw?.[q.id];
      const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
      if (empty) { if (q.required) errors[q.id] = 'required'; continue; }
      if (q.type === 'multi') {
        value = (Array.isArray(value) ? value : [value]).map(String);
        if (value.some((v) => !q.options.includes(v))) { errors[q.id] = 'invalid'; continue; }
        value = [...new Set(value)];
      } else if (q.type === 'choice') {
        value = String(value);
        if (!q.options.includes(value)) { errors[q.id] = 'invalid'; continue; }
      } else if (q.type === 'yesno') {
        value = value === true || value === 'yes' || value === 'true' ? 'Yes' : value === false || value === 'no' || value === 'false' ? 'No' : null;
        if (!value) { errors[q.id] = 'invalid'; continue; }
      } else if (q.type === 'number') {
        const text = String(value).trim();
        if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(text)) { errors[q.id] = 'invalid'; continue; }
        value = text;
      } else {
        value = clip(value, q.type === 'paragraph' ? LIMITS.paragraph : LIMITS.short);
        if (!value) { if (q.required) errors[q.id] = 'required'; continue; }
      }
      answers.push({ id: q.id, label: q.label, type: q.type, value });
    }
  }
  return { ok: Object.keys(errors).length === 0, answers, errors };
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

function staffCardText(submission, form, config) {
  const lines = [`## Appeal · ${clip(submission.form_name || form?.name, 80)}`, `<@${submission.user_id}> · \`${submission.username}\` · \`${submission.user_id}\``];
  const punishments = submission.punishments ?? [];
  if (punishments.length) {
    lines.push('', '**Punishments**', ...punishments.slice(0, 6).map((p) => `• ${p.type}${p.reason ? ` — ${clip(p.reason, 140)}` : ''}${p.until ? ` · until <t:${Math.floor(Date.parse(p.until) / 1000)}:f>` : ''}${p.source === 'discord' ? ' (Discord)' : ''}`));
  }
  lines.push('');
  let used = lines.join('\n').length;
  for (const a of submission.answers ?? []) {
    const value = Array.isArray(a.value) ? a.value.join(', ') : String(a.value);
    const block = `**${clip(a.label, 120)}**\n${clip(value, 700)}\n`;
    if (used + block.length > 3500) { lines.push('*…more answers in the dashboard*'); break; }
    lines.push(block); used += block.length;
  }
  if (submission.invite_note) lines.push(`**Invite** — ${submission.invite_url ? `${submission.invite_url} (${submission.invite_note})` : submission.invite_note}`, '');
  lines.push(`-# ID ${submission.id}`);
  return lines.join('\n');
}

function staffButtons(submissionId, resolved = false) {
  const row = new ActionRowBuilder();
  if (!resolved) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}::accept::${submissionId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}::reject::${submissionId}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
    );
  }
  row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}::reply::${submissionId}`).setLabel('Reply').setStyle(ButtonStyle.Secondary));
  return row;
}

const STATUS_COLORS = { pending: 0xfed53c, accepted: 0xa5ea7a, rejected: 0xfe6465, withdrawn: 0x4b4f59 };

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
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
  const checked = validateAnswers(form, rawAnswers);
  if (!checked.ok) return { ok: false, error: 'invalid', fields: checked.errors };
  const channel = await fetchChannel(guild, config.submission_channel_id);
  if (!channel) return { ok: false, error: 'no_channel' };

  const submission = await db.createSubmission({
    guild_id: guild.id, form_id: form.id, form_name: form.name, user_id: user.id, username: clip(user.username, 80),
    avatar_url: user.avatarUrl ?? null, answers: checked.answers, punishments,
  });
  try {
    const pings = (config.ping_role_ids ?? []).filter((r) => guild.roles.cache.has(r));
    const message = await channel.send({
      // A Components V2 message cannot carry `content`: the role pings go at the top of the card.
      components: [textCard(`${pings.length ? `${pings.map((r) => `<@&${r}>`).join(' ')}\n` : ''}${staffCardText(submission, form, config)}`, STATUS_COLORS.pending), staffButtons(submission.id)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { roles: pings, parse: [] },
    });
    let threadId = null;
    if (config.auto_thread && channel.type === ChannelType.GuildText && message.startThread) {
      const name = renderTemplate(config.thread_name, { username: user.username }).slice(0, 100) || `Appeal by ${user.username}`;
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
  await logLine(guild, config, `**${clip(user.username, 40)}** sent an appeal (${clip(form.name, 60)}).`, STATUS_COLORS.pending);
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
async function inviteFor(guild, config, form) {
  const fixed = config.rejoin_invite_code ? `https://discord.gg/${config.rejoin_invite_code}` : null;
  const wantsNew = Boolean(config.auto_invite || form?.generate_invite);
  if (!wantsNew) return fixed ? { url: fixed, note: 'fixed invite of the server' } : { url: null, note: 'no invite is set' };
  const me = guild.members.me;
  const channel = guild.channels.cache.find((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type) && me?.permissionsIn(c).has(PermissionFlagsBits.CreateInstantInvite));
  if (!channel) return { url: fixed, note: `Petto could not create an invite: it needs Create Invite in a text channel${fixed ? '; the fixed invite was sent instead' : ''}` };
  const invite = await channel.createInvite({ maxAge: 7 * 86_400, maxUses: 1, unique: true, reason: 'Accepted appeal' }).catch(() => null);
  if (!invite) return { url: fixed, note: `Discord did not let Petto create an invite${fixed ? '; the fixed invite was sent instead' : ''}` };
  return { url: invite.url, note: `single-use invite created in #${channel.name}, valid 7 days` };
}

/** Lifts what the member was appealing: the ban and the timeout. Petto cases are lifted through the same path as the dashboard. */
async function liftPunishments(guild, submission, moderatorId) {
  const done = [];
  const user = { id: moderatorId, username: moderatorId };
  const { liftSanction, isLiftable } = require('./sanctionLift');
  const { getUserHistory } = require('../db/modActions');
  const history = await getUserHistory(guild.id, submission.user_id, { limit: 50 }).catch(() => []);
  for (const row of history.filter(isLiftable)) {
    await liftSanction(guild, row.case_number, user, 'Appeal accepted').then(() => done.push(`${row.type} #${row.case_number}`)).catch((err) => logger.warn(`Appeals: could not lift case ${row.case_number}: ${err.message}`));
  }
  if (await guild.bans.fetch({ user: submission.user_id, force: true }).catch(() => null)) {
    const { getHardBan } = require('../db/hardBans');
    if (!(await getHardBan(guild.id, submission.user_id).catch(() => null))) {
      await guild.members.unban(submission.user_id, 'Appeal accepted').then(() => done.push('ban')).catch(() => {});
    }
  }
  const member = guild.members.cache.get(submission.user_id) ?? await guild.members.fetch(submission.user_id).catch(() => null);
  if (member?.isCommunicationDisabled?.()) await member.timeout(null, 'Appeal accepted').then(() => done.push('timeout')).catch(() => {});
  return done;
}

/** Accepts or rejects a pending appeal: stores it, updates the card, writes to the member and applies the form's rules. */
async function resolveAppeal({ client, guild, submission, status, moderatorId, moderatorName = null, reason = null }) {
  if (!['accepted', 'rejected'].includes(status)) return { ok: false, error: 'bad_status' };
  const row = await db.resolveSubmission(submission.id, { status, resolved_by: moderatorId, resolved_at: new Date().toISOString(), resolution_reason: clip(reason, 800) || null });
  if (!row) return { ok: false, error: 'already_resolved' };
  const config = await db.getConfig(guild.id);
  const form = row.form_id ? await db.getForm(guild.id, row.form_id).catch(() => null) : null;
  const vars = { server: guild.name, reason: clip(reason, 800) || '', form: row.form_name, username: row.username, link: `${siteLink(guild.id, config.slug)}/status/${row.id}` };
  let invite = null;
  let lifted = [];
  if (status === 'accepted') {
    lifted = await liftPunishments(guild, row, moderatorId);
    invite = await inviteFor(guild, config, form);
    // The staff can see which invite was made, or why there is none.
    row.invite_url = invite.url; row.invite_note = invite.note;
    await db.updateSubmission(row.id, { invite_url: invite.url, invite_note: invite.note }).catch(() => {});
  } else if (form?.block_on_reject && form.block_on_reject !== 'none') {
    await db.setBlock(guild.id, row.user_id, blockUntil(form.block_on_reject), 'Appeal rejected').catch(() => {});
  }
  const text = `${renderTemplate(messageFor(config, form, status), vars)}${invite?.url ? `\n\n${labelsFor(config).rejoin}: ${invite.url}` : ''}\n\n-# ${siteLink(guild.id, config.slug)}/status/${row.id}`;
  const dm = await sendDm(client, row.user_id, text, STATUS_COLORS[status]);
  await db.addMessage({ submission_id: row.id, guild_id: guild.id, author_type: 'system', author_name: 'Petto', content: renderTemplate(messageFor(config, form, status), vars) + (invite?.url ? `\n${invite.url}` : '') }).catch(() => {});
  await updateStaffCard(guild, row, form, config, moderatorId);
  const who = moderatorName ?? `<@${moderatorId}>`;
  await logLine(guild, config, `${who} ${status} the appeal of **${clip(row.username, 40)}**${lifted.length ? ` (lifted: ${lifted.join(', ')})` : ''}${row.invite_note ? `. Invite: ${row.invite_url ? `${row.invite_url} (${row.invite_note})` : row.invite_note}` : ''}.`, STATUS_COLORS[status]);
  return { ok: true, submission: row, dm, invite, lifted };
}

async function updateStaffCard(guild, row, form, config, moderatorId) {
  const channel = await fetchChannel(guild, row.channel_id);
  if (!channel || !row.message_id) return;
  const message = await channel.messages.fetch(row.message_id).catch(() => null);
  if (!message) return;
  const stamp = row.resolved_at ? Math.floor(Date.parse(row.resolved_at) / 1000) : Math.floor(Date.now() / 1000);
  const text = `${staffCardText(row, form, config)}\n\n**${row.status === 'accepted' ? 'Accepted' : 'Rejected'}** by <@${moderatorId}> · <t:${stamp}:R>${row.resolution_reason ? `\n> ${clip(row.resolution_reason, 300)}` : ''}`;
  await message.edit({ components: [textCard(text, STATUS_COLORS[row.status]), staffButtons(row.id, true)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => {});
}

/** A message from the staff to the member (and the DM that tells them), from the card or from the dashboard. */
async function staffReply({ client, guild, submission, content, moderatorId, moderatorName }) {
  const text = clip(content, LIMITS.reply);
  if (!text) return { ok: false, error: 'empty' };
  const config = await db.getConfig(guild.id);
  const anonymous = Boolean(config.anonymous_messages);
  await db.addMessage({ submission_id: submission.id, guild_id: guild.id, author_type: 'staff', author_id: moderatorId, author_name: moderatorName ?? null, content: text, anonymous });
  const form = submission.form_id ? await db.getForm(guild.id, submission.form_id).catch(() => null) : null;
  const dm = await sendDm(client, submission.user_id, `${renderTemplate(messageFor(config, form, 'reply'), { server: guild.name })}\n\n**${anonymous ? 'Staff' : clip(moderatorName ?? 'Staff', 40)}**\n${text}\n\n-# ${config.allow_replies ? labelsFor(config).answer : ''}${siteLink(guild.id, config.slug)}/status/${submission.id}`, 0x8c7cff);
  await notifyStaff(guild, submission, `<@${moderatorId}> replied to **${clip(submission.username, 40)}**\n> ${text.slice(0, 400)}`, 0x8c7cff);
  return { ok: true, dm };
}

/** A message from the member, from the site: kept and shown to the staff where the appeal is. */
async function userReply({ guild, config, submission, content }) {
  if (!config.allow_replies) return { ok: false, error: 'replies_off' };
  if (submission.status !== 'pending') return { ok: false, error: 'closed' };
  const text = clip(content, LIMITS.reply);
  if (!text) return { ok: false, error: 'empty' };
  await db.addMessage({ submission_id: submission.id, guild_id: guild.id, author_type: 'user', author_id: submission.user_id, author_name: submission.username, content: text });
  await notifyStaff(guild, submission, `**${clip(submission.username, 40)}** wrote about their appeal\n> ${text.slice(0, 600)}`, 0xfed53c);
  return { ok: true };
}

async function withdrawAppeal({ guild, config, submission }) {
  const row = await db.resolveSubmission(submission.id, { status: 'withdrawn', resolved_by: submission.user_id, resolved_at: new Date().toISOString() });
  if (!row) return { ok: false, error: 'already_resolved' };
  const form = row.form_id ? await db.getForm(guild.id, row.form_id).catch(() => null) : null;
  await updateStaffCard(guild, { ...row, resolution_reason: 'Withdrawn by the member' }, form, config, row.user_id);
  await logLine(guild, config, `**${clip(row.username, 40)}** withdrew their appeal.`, STATUS_COLORS.withdrawn);
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
  staffCardText, staffButtons, submitAppeal, resolveAppeal, staffReply, userReply, withdrawAppeal, cleanup,
};
