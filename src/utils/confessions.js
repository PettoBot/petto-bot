// Confessions: a member confesses without a name. The message goes out as the bot or through a webhook with a name and picture the server
// chose, with or without the staff checking it first, and anyone can answer it anonymously in a thread. The author is kept only for the
// staff (to reveal who it was or block them) and the server can turn even that off.
const crypto = require('node:crypto');
const { PermissionFlagsBits, AttachmentBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/confessions');
const { build } = require('./embedBuilder');
const { templatePayload } = require('./templatedMessage');
const { webhookFor } = require('./senderIdentity');
const { splitImage, copyPicture } = require('./suggestions');
const logger = require('./logger');
const { t, tn, guildLanguage, currentLanguage } = require('../i18n');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MAX_CONTENT = 1800;
const BUTTON_PREFIX = 'cfs';
const YELLOW = 0xffd563;
const RED = 0xff6b6b;
const V2 = MessageFlags.IsComponentsV2;

function makeId() {
  const part = () => Array.from({ length: 5 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
}

// The texts a server has until it writes its own are stored in English (the defaults of db/confessions.js and of the table): those are
// shown in the language of the server, and anything the server wrote is shown as it is.
const DEFAULT_KEYS = { title: 'confessions.default.title', footer: 'confessions.default.footer', button_label: 'confessions.default.confess.button', reply_label: 'confessions.default.reply.button', panel_text: 'confessions.default.panelText', webhook_name: 'confessions.default.webhookName' };
function shownText(config, field, lang) {
  const value = config[field];
  return value === t('en', DEFAULT_KEYS[field]) ? t(lang, DEFAULT_KEYS[field]) : value;
}

const isHttps = (value) => { try { return new URL(String(value)).protocol === 'https:'; } catch { return false; } };

/** `{ buffer, name }` for a picture given as a link, null when it is not one Discord shows. */
const takePicture = (url) => copyPicture(url);

/** What `{confession.*}` says about one confession. */
function confessionVars(row, guild) {
  return {
    id: row.id,
    number: row.number,
    content: row.content,
    image: row.image_url ?? '',
    link: row.message_id && row.channel_id ? `https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id}` : '',
    channelId: row.channel_id ?? '',
    unix: Math.floor(new Date(row.created_at ?? Date.now()).getTime() / 1000),
  };
}

function replyButtonRow(row, config, lang = currentLanguage()) {
  return { type: 1, components: [{ type: 2, style: 2, custom_id: `${BUTTON_PREFIX}:reply:${row.id}`, label: String(shownText(config, 'reply_label', lang) || t(lang, DEFAULT_KEYS.reply_label)).slice(0, 80) }] };
}

/** The usual look, written as a design so a saved one of the dashboard can change any part of it. */
function defaultDesign(config, row, { reply = false, lang = currentLanguage() } = {}) {
  const children = [{ type: 10, content: `### ${reply ? t(lang, 'confessions.replyTitle') : shownText(config, 'title', lang)}\n{confession.content}` }];
  if (row.image_url) children.push({ type: 12, items: [{ media: { url: '{confession.image}' } }] });
  if (config.footer && !reply) children.push({ type: 14, divider: true, spacing: 1 }, { type: 10, content: `-# ${shownText(config, 'footer', lang)}` });
  return { v2: { components: [{ type: 17, accent_color: config.color, components: children }] } };
}

/** The message of a confession (or of an anonymous reply), ready to send, in the language of the server (`lang`, found when not given). */
async function render(guild, row, config, { pictureName = null, reply = false, lang = null } = {}) {
  const language = lang ?? await guildLanguage(guild.id);
  const own = /^attachment:\/\/([\w.-]+)$/.exec(row.image_url ?? '');
  const ctx = { guild, confession: confessionVars(row, guild), attachmentNames: new Set([own?.[1], pictureName].filter(Boolean)) };
  let payload = null;
  if (config.embed_template && !reply) payload = await templatePayload(guild.id, config.embed_template, ctx);
  if (!payload) {
    const built = await build(defaultDesign(config, row, { reply, lang: language }), { ...ctx, allowV2: true });
    payload = { components: built.components, files: built.files ?? [], embeds: [], flags: built.flags };
  }
  const rows = !reply && config.allow_replies ? [replyButtonRow(row, config, language)] : [];
  return { content: payload.content || undefined, embeds: payload.embeds ?? [], components: [...(payload.components ?? []), ...rows], files: payload.files ?? [], flags: payload.flags ?? V2, allowedMentions: { parse: [] } };
}

/**
 * The picture a confession shows: the one the server chose in the dashboard, else the picture Petto has in that server (when the server
 * gave it its own), else the usual picture of Petto.
 */
function avatarFor(guild, config) {
  if (isHttps(config.webhook_avatar)) return config.webhook_avatar;
  const own = guild?.members?.me?.avatarURL?.({ extension: 'png', size: 256 });
  return own || guild?.client?.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || undefined;
}

/** Sends as the name and picture the server chose (a webhook of the bot), or as the bot when that cannot be done. `name` changes the name shown. */
async function sendAnonymous(channel, config, payload, { name = null, lang = currentLanguage() } = {}) {
  if (config.use_webhook) {
    const hook = await webhookFor(channel, channel.client);
    if (hook) {
      try {
        const options = { ...payload, username: String(name || shownText(config, 'webhook_name', lang) || t(lang, DEFAULT_KEYS.webhook_name)).slice(0, 80), avatarURL: avatarFor(channel.guild, config), withComponents: true };
        if (channel.isThread?.()) options.threadId = channel.id;
        return await hook.send(options);
      } catch (error) {
        logger.warn({ guildId: channel.guild?.id, action: 'confession' }, `A confession could not go through the webhook: ${error.message}`);
      }
    }
  }
  return channel.send(payload);
}

/** The panel: a message with a button that opens the form, for servers that want confessions without a command. */
function buildPanel(guild, config, lang = currentLanguage()) {
  const container = new ContainerBuilder().setAccentColor(config.color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'confessions.panel.text', { text: shownText(config, 'panel_text', lang) })))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}:new`).setLabel(String(shownText(config, 'button_label', lang) || t(lang, DEFAULT_KEYS.button_label)).slice(0, 80)).setStyle(ButtonStyle.Success)));
  return { components: [container], flags: V2, allowedMentions: { parse: [] } };
}

const panelQueue = new Map();

/**
 * Sends the panel again so it is the last message of the channel: the one posted before goes away. `force` posts it in `channelId` even if
 * it had no panel there yet. Returns `{ ok, message }`, in the language of the server (the dashboard shows it too).
 */
async function postPanel(guild, config, channelId) {
  const lang = await guildLanguage(guild.id);
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || channel.isThread?.()) return { ok: false, message: t(lang, 'confessions.panel.pickChannel') };
  if (!channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return { ok: false, message: t(lang, 'confessions.panel.cannotWrite', { channel: channel.name }) };
  if (config.panel_message_id && config.panel_channel_id) {
    const old = await guild.channels.fetch(config.panel_channel_id).catch(() => null);
    const oldMessage = old?.isTextBased?.() ? await old.messages.fetch(config.panel_message_id).catch(() => null) : null;
    await oldMessage?.delete().catch(() => {});
  }
  const message = await channel.send(buildPanel(guild, config, lang));
  await db.updateConfig(guild.id, { panel_channel_id: channel.id, panel_message_id: message.id });
  return { ok: true, message: t(lang, 'confessions.panel.posted', { channel: channel.name }) };
}

/** After a confession, the panel of that channel goes back to the bottom. One at a time per server; it never stops a confession. */
function bumpPanel(guild, config, channelId) {
  if (!config.panel_message_id || config.panel_channel_id !== channelId) return Promise.resolve();
  const previous = panelQueue.get(guild.id) ?? Promise.resolve();
  const next = previous.then(async () => {
    const fresh = await db.getConfig(guild.id);
    if (fresh.panel_message_id && fresh.panel_channel_id === channelId) await postPanel(guild, fresh, channelId);
  }).catch((error) => logger.warn({ guildId: guild.id, action: 'confession' }, `The panel could not go back to the bottom: ${error.message}`));
  panelQueue.set(guild.id, next);
  return next;
}

/**
 * A line in the log of the staff (a card in the log channel), for what the staff did with confessions. Never stops what was being done.
 * `text` is already in the language of the server.
 */
async function logAction(guild, config, text, color = 0x4b4f59) {
  if (!config?.log_channel_id) return;
  try {
    const channel = await guild.channels.fetch(config.log_channel_id).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const lang = await guildLanguage(guild.id);
    const card = new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'confessions.log.card', { text })));
    await sendAnonymous(channel, { ...config, use_webhook: config.use_webhook }, { components: [card], flags: V2, allowedMentions: { parse: [] } }, { name: t(lang, 'confessions.log.name'), lang });
  } catch (error) {
    logger.warn({ guildId: guild.id, action: 'confession' }, `The confessions log could not be written: ${error.message}`);
  }
}

const isStaff = (member, config) => Boolean(member && (member.permissions?.has(PermissionFlagsBits.ManageGuild) || (config?.staff_role_id && member.roles?.cache?.has(config.staff_role_id))));

/** Posts a confession that is ready (no review needed or already approved). Returns the updated row. */
async function publish(guild, row, config, picture = null, lang = currentLanguage()) {
  const channel = await guild.channels.fetch(config.channel_id).catch(() => null);
  // i18n-ignore: internal error, only logged (the member gets a message of their own)
  if (!channel?.isTextBased?.() || channel.isThread?.()) throw new Error('The channel for confessions is not there any more.');
  const shown = picture ? { ...row, image_url: `attachment://${picture.name}` } : row;
  const payload = await render(guild, shown, config, { pictureName: picture?.name, lang });
  if (picture) payload.files = [...payload.files, new AttachmentBuilder(picture.buffer, { name: picture.name })];
  const message = await sendAnonymous(channel, config, payload, { lang });
  const keepImage = picture ? `attachment://${picture.name}` : row.image_url;
  const posted = await db.update(row.id, { status: 'posted', channel_id: channel.id, message_id: message.id, image_url: keepImage });
  // The panel goes back to the bottom, under the confession that just came out.
  bumpPanel(guild, config, channel.id);
  return posted;
}

/** The card the staff sees to approve or reject a confession. */
function reviewCard(row, config, { status = 'pending', by = null, pictureName = null, lang = currentLanguage() } = {}) {
  const color = status === 'rejected' ? RED : status === 'approved' ? config.color : YELLOW;
  const label = status === 'rejected' ? t(lang, 'confessions.review.rejectedBy', { staff: `<@${by}>` }) : status === 'approved' ? t(lang, 'confessions.review.approvedBy', { staff: `<@${by}>` }) : t(lang, 'confessions.review.waiting');
  const children = [{ type: 10, content: `${t(lang, 'confessions.review.title', { number: row.number, status: label })}\n${String(row.content).slice(0, 1800)}\n-# ID: \`${row.id}\`` }];
  if (pictureName) children.push({ type: 12, items: [{ media: { url: `attachment://${pictureName}` } }] });
  if (status === 'pending') {
    children.push({ type: 1, components: [
      { type: 2, style: 3, custom_id: `${BUTTON_PREFIX}:ok:${row.id}`, label: t(lang, 'confessions.review.approve.button') },
      { type: 2, style: 4, custom_id: `${BUTTON_PREFIX}:no:${row.id}`, label: t(lang, 'confessions.review.reject.button') },
    ] });
  }
  return { flags: V2, components: [{ type: 17, accent_color: color, components: children }], allowedMentions: { parse: [] } };
}

/**
 * A confession from a member. Returns `{ error }` for the member, `{ row, review: true }` when it waits for the staff, or `{ row, message }`.
 * `attachments` are the files the member sent with a command, if any; a link to a picture can also be written in the text or given as `imageUrl`.
 */
async function submit({ guild, user, text, attachments = [], imageUrl = null }) {
  const lang = await guildLanguage(guild.id);
  const config = await db.getConfig(guild.id);
  if (!config.enabled || !config.channel_id) return { error: t(lang, 'confessions.error.off') };
  if (await db.isBlocked(guild.id, user.id)) return { error: t(lang, 'confessions.error.blocked') };
  let { content, imageUrl: found } = splitImage(text, attachments);
  let picUrl = found ?? (imageUrl && isHttps(imageUrl) ? imageUrl : null);
  if (picUrl && !config.allow_images) { picUrl = null; }
  if (!content && !picUrl) return { error: t(lang, 'confessions.error.empty') };
  if (content.length > MAX_CONTENT) return { error: t(lang, 'confessions.error.tooLong', { max: MAX_CONTENT, length: content.length }) };
  if (config.cooldown_seconds > 0) {
    const last = await db.lastBy(guild.id, user.id);
    const wait = last ? Math.ceil((last.getTime() + config.cooldown_seconds * 1000 - Date.now()) / 1000) : 0;
    if (wait > 0) return { error: tn(lang, 'confessions.error.wait', wait, { count: wait }) };
  }
  const me = guild.members.me;
  const target = config.require_review && config.review_channel_id ? config.review_channel_id : config.channel_id;
  const channel = await guild.channels.fetch(target).catch(() => null);
  if (!channel?.isTextBased?.()) return { error: t(lang, 'confessions.error.noChannel') };
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return { error: t(lang, 'confessions.error.cannotWrite', { channel: `${channel}` }) };

  const picture = picUrl ? await takePicture(picUrl) : null;
  let row = await db.create({ id: makeId(), guild_id: guild.id, number: await db.nextNumber(guild.id), author_id: config.keep_author ? user.id : null, content: content || t(lang, 'confessions.pictureOnly'), image_url: picture ? `attachment://${picture.name}` : null });
  try {
    if (config.require_review && config.review_channel_id) {
      const card = reviewCard(row, config, { pictureName: picture?.name, lang });
      if (picture) card.files = [new AttachmentBuilder(picture.buffer, { name: picture.name })];
      const message = await sendAnonymous(channel, config, card, { name: t(lang, 'confessions.review.name'), lang });
      row = await db.update(row.id, { review_channel_id: channel.id, review_message_id: message.id, image_url: message.attachments?.first?.()?.url ?? row.image_url });
      return { row, review: true };
    }
    row = await publish(guild, row, config, picture, lang);
    return { row, message: { url: `https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id}` } };
  } catch (err) {
    logger.warn(`A confession could not be posted in ${guild.id}: ${err.message}`);
    await db.remove(guild.id, row.id).catch(() => {});
    return { error: t(lang, 'confessions.error.postFailed') };
  }
}

/** The staff approves or rejects a confession that waits. Returns `{ error }` or `{ row }`. */
async function decide({ guild, member, id, approve }) {
  const lang = await guildLanguage(guild.id);
  const config = await db.getConfig(guild.id);
  if (!isStaff(member, config)) return { error: t(lang, 'confessions.error.staffOnly') };
  const row = await db.getById(id);
  if (!row || row.guild_id !== guild.id) return { error: t(lang, 'confessions.error.gone') };
  if (row.status !== 'pending') return { error: t(lang, row.status === 'posted' ? 'confessions.error.alreadyApproved' : 'confessions.error.alreadyRejected') };
  let updated;
  if (approve) {
    try {
      const own = /^https?:\/\//.test(row.image_url ?? '') ? await takePicture(row.image_url) : null;
      updated = await publish(guild, row, config, own, lang);
    } catch (err) {
      logger.warn(`A confession could not be published in ${guild.id}: ${err.message}`);
      return { error: t(lang, 'confessions.error.publishFailed') };
    }
  } else {
    updated = await db.update(id, { status: 'rejected', reviewed_by: member.id });
  }
  if (approve) updated = await db.update(id, { reviewed_by: member.id });
  await logAction(guild, config, t(lang, approve ? 'confessions.log.approved' : 'confessions.log.rejected', { staff: `${member}`, id, number: row.number }), approve ? config.color : RED);
  return { row: updated, config };
}

/** An anonymous reply to a confession, in a thread of it. Returns `{ error }` or `{ row }`. */
async function reply({ guild, user, id, text }) {
  const lang = await guildLanguage(guild.id);
  const config = await db.getConfig(guild.id);
  if (!config.enabled || !config.allow_replies) return { error: t(lang, 'confessions.error.repliesOff') };
  if (await db.isBlocked(guild.id, user.id)) return { error: t(lang, 'confessions.error.blocked') };
  const parent = await db.getById(id);
  if (!parent || parent.guild_id !== guild.id || parent.status !== 'posted') return { error: t(lang, 'confessions.error.parentGone') };
  const content = String(text ?? '').trim();
  if (!content) return { error: t(lang, 'confessions.error.emptyReply') };
  if (content.length > MAX_CONTENT) return { error: t(lang, 'confessions.error.replyTooLong', { max: MAX_CONTENT }) };
  if (config.cooldown_seconds > 0) {
    const last = await db.lastBy(guild.id, user.id);
    const wait = last ? Math.ceil((last.getTime() + config.cooldown_seconds * 1000 - Date.now()) / 1000) : 0;
    if (wait > 0) return { error: tn(lang, 'confessions.error.waitReply', wait, { count: wait }) };
  }
  const channel = await guild.channels.fetch(parent.channel_id).catch(() => null);
  const message = channel?.isTextBased?.() ? await channel.messages.fetch(parent.message_id).catch(() => null) : null;
  if (!message) return { error: t(lang, 'confessions.error.notFound') };
  let thread = parent.thread_id ? await guild.channels.fetch(parent.thread_id).catch(() => null) : null;
  if (!thread) {
    try {
      thread = await message.startThread({ name: t(lang, 'confessions.thread', { number: parent.number }).slice(0, 100), autoArchiveDuration: 1440 });
      await db.update(parent.id, { thread_id: thread.id });
    } catch (err) {
      logger.warn(`The thread of a confession could not be made in ${guild.id}: ${err.message}`);
      return { error: t(lang, 'confessions.error.threadFailed') };
    }
  }
  const row = await db.create({ id: makeId(), guild_id: guild.id, number: await db.nextNumber(guild.id), author_id: config.keep_author ? user.id : null, content, status: 'posted', channel_id: thread.id, reply_to: parent.id });
  try {
    const payload = await render(guild, row, config, { reply: true, lang });
    const sent = await sendAnonymous(thread, config, payload, { lang });
    await db.update(row.id, { message_id: sent.id });
  } catch (err) {
    logger.warn(`An anonymous reply could not be posted in ${guild.id}: ${err.message}`);
    await db.remove(guild.id, row.id).catch(() => {});
    return { error: t(lang, 'confessions.error.replyFailed') };
  }
  return { row, thread };
}

module.exports = { BUTTON_PREFIX, MAX_CONTENT, makeId, confessionVars, defaultDesign, render, avatarFor, sendAnonymous, buildPanel, postPanel, bumpPanel, logAction, isStaff, publish, reviewCard, submit, decide, reply };
