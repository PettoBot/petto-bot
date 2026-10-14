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

function replyButtonRow(row, config) {
  return { type: 1, components: [{ type: 2, style: 2, custom_id: `${BUTTON_PREFIX}:reply:${row.id}`, label: String(config.reply_label || 'Reply anonymously').slice(0, 80) }] };
}

/** The usual look, written as a design so a saved one of the dashboard can change any part of it. */
function defaultDesign(config, row, { reply = false } = {}) {
  const children = [{ type: 10, content: `### ${reply ? 'Anonymous reply' : config.title}\n{confession.content}` }];
  if (row.image_url) children.push({ type: 12, items: [{ media: { url: '{confession.image}' } }] });
  if (config.footer && !reply) children.push({ type: 14, divider: true, spacing: 1 }, { type: 10, content: `-# ${config.footer}` });
  return { v2: { components: [{ type: 17, accent_color: config.color, components: children }] } };
}

/** The message of a confession (or of an anonymous reply), ready to send. */
async function render(guild, row, config, { pictureName = null, reply = false } = {}) {
  const own = /^attachment:\/\/([\w.-]+)$/.exec(row.image_url ?? '');
  const ctx = { guild, confession: confessionVars(row, guild), attachmentNames: new Set([own?.[1], pictureName].filter(Boolean)) };
  let payload = null;
  if (config.embed_template && !reply) payload = await templatePayload(guild.id, config.embed_template, ctx);
  if (!payload) {
    const built = await build(defaultDesign(config, row, { reply }), { ...ctx, allowV2: true });
    payload = { components: built.components, files: built.files ?? [], embeds: [], flags: built.flags };
  }
  const rows = !reply && config.allow_replies ? [replyButtonRow(row, config)] : [];
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
async function sendAnonymous(channel, config, payload, { name = null } = {}) {
  if (config.use_webhook) {
    const hook = await webhookFor(channel, channel.client);
    if (hook) {
      try {
        const options = { ...payload, username: String(name || config.webhook_name || 'Anonymous').slice(0, 80), avatarURL: avatarFor(channel.guild, config), withComponents: true };
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
function buildPanel(guild, config) {
  const container = new ContainerBuilder().setAccentColor(config.color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Confessions\n${config.panel_text}`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}:new`).setLabel(String(config.button_label || 'Confess').slice(0, 80)).setStyle(ButtonStyle.Success)));
  return { components: [container], flags: V2, allowedMentions: { parse: [] } };
}

const panelQueue = new Map();

/**
 * Sends the panel again so it is the last message of the channel: the one posted before goes away. `force` posts it in `channelId` even if
 * it had no panel there yet. Returns `{ ok, message }`.
 */
async function postPanel(guild, config, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || channel.isThread?.()) return { ok: false, message: 'Pick a text channel for the panel.' };
  if (!channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return { ok: false, message: `I cannot write in #${channel.name}.` };
  if (config.panel_message_id && config.panel_channel_id) {
    const old = await guild.channels.fetch(config.panel_channel_id).catch(() => null);
    const oldMessage = old?.isTextBased?.() ? await old.messages.fetch(config.panel_message_id).catch(() => null) : null;
    await oldMessage?.delete().catch(() => {});
  }
  const message = await channel.send(buildPanel(guild, config));
  await db.updateConfig(guild.id, { panel_channel_id: channel.id, panel_message_id: message.id });
  return { ok: true, message: `The panel is at the bottom of #${channel.name}.` };
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

/** A line in the log of the staff (a card in the log channel), for what the staff did with confessions. Never stops what was being done. */
async function logAction(guild, config, text, color = 0x4b4f59) {
  if (!config?.log_channel_id) return;
  try {
    const channel = await guild.channels.fetch(config.log_channel_id).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const card = new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Confessions log\n${text}`));
    await sendAnonymous(channel, { ...config, use_webhook: config.use_webhook }, { components: [card], flags: V2, allowedMentions: { parse: [] } }, { name: 'Confessions log' });
  } catch (error) {
    logger.warn({ guildId: guild.id, action: 'confession' }, `The confessions log could not be written: ${error.message}`);
  }
}

const isStaff = (member, config) => Boolean(member && (member.permissions?.has(PermissionFlagsBits.ManageGuild) || (config?.staff_role_id && member.roles?.cache?.has(config.staff_role_id))));

/** Posts a confession that is ready (no review needed or already approved). Returns the updated row. */
async function publish(guild, row, config, picture = null) {
  const channel = await guild.channels.fetch(config.channel_id).catch(() => null);
  if (!channel?.isTextBased?.() || channel.isThread?.()) throw new Error('The channel for confessions is not there any more.');
  const shown = picture ? { ...row, image_url: `attachment://${picture.name}` } : row;
  const payload = await render(guild, shown, config, { pictureName: picture?.name });
  if (picture) payload.files = [...payload.files, new AttachmentBuilder(picture.buffer, { name: picture.name })];
  const message = await sendAnonymous(channel, config, payload);
  const keepImage = picture ? `attachment://${picture.name}` : row.image_url;
  const posted = await db.update(row.id, { status: 'posted', channel_id: channel.id, message_id: message.id, image_url: keepImage });
  // The panel goes back to the bottom, under the confession that just came out.
  bumpPanel(guild, config, channel.id);
  return posted;
}

/** The card the staff sees to approve or reject a confession. */
function reviewCard(row, config, { status = 'pending', by = null, pictureName = null } = {}) {
  const color = status === 'rejected' ? RED : status === 'approved' ? config.color : YELLOW;
  const label = status === 'rejected' ? `Rejected by <@${by}>` : status === 'approved' ? `Approved by <@${by}>` : 'Waiting for the staff';
  const children = [{ type: 10, content: `### Confession #${row.number} · ${label}\n${String(row.content).slice(0, 1800)}\n-# ID: \`${row.id}\`` }];
  if (pictureName) children.push({ type: 12, items: [{ media: { url: `attachment://${pictureName}` } }] });
  if (status === 'pending') {
    children.push({ type: 1, components: [
      { type: 2, style: 3, custom_id: `${BUTTON_PREFIX}:ok:${row.id}`, label: 'Approve' },
      { type: 2, style: 4, custom_id: `${BUTTON_PREFIX}:no:${row.id}`, label: 'Reject' },
    ] });
  }
  return { flags: V2, components: [{ type: 17, accent_color: color, components: children }], allowedMentions: { parse: [] } };
}

/**
 * A confession from a member. Returns `{ error }` for the member, `{ row, review: true }` when it waits for the staff, or `{ row, message }`.
 * `attachments` are the files the member sent with a command, if any; a link to a picture can also be written in the text or given as `imageUrl`.
 */
async function submit({ guild, user, text, attachments = [], imageUrl = null }) {
  const config = await db.getConfig(guild.id);
  if (!config.enabled || !config.channel_id) return { error: 'Confessions are not turned on in this server.' };
  if (await db.isBlocked(guild.id, user.id)) return { error: 'You cannot make confessions in this server.' };
  let { content, imageUrl: found } = splitImage(text, attachments);
  let picUrl = found ?? (imageUrl && isHttps(imageUrl) ? imageUrl : null);
  if (picUrl && !config.allow_images) { picUrl = null; }
  if (!content && !picUrl) return { error: 'Write your confession first.' };
  if (content.length > MAX_CONTENT) return { error: `A confession can have up to ${MAX_CONTENT} letters. Yours has ${content.length}.` };
  if (config.cooldown_seconds > 0) {
    const last = await db.lastBy(guild.id, user.id);
    const wait = last ? Math.ceil((last.getTime() + config.cooldown_seconds * 1000 - Date.now()) / 1000) : 0;
    if (wait > 0) return { error: `Wait ${wait} second${wait === 1 ? '' : 's'} before the next confession.` };
  }
  const me = guild.members.me;
  const target = config.require_review && config.review_channel_id ? config.review_channel_id : config.channel_id;
  const channel = await guild.channels.fetch(target).catch(() => null);
  if (!channel?.isTextBased?.()) return { error: 'The channel for confessions is not there any more. Ask the staff to pick it again.' };
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return { error: `I cannot write in ${channel}. Ask the staff to give me access.` };

  const picture = picUrl ? await takePicture(picUrl) : null;
  let row = await db.create({ id: makeId(), guild_id: guild.id, number: await db.nextNumber(guild.id), author_id: config.keep_author ? user.id : null, content: content || '*(a picture)*', image_url: picture ? `attachment://${picture.name}` : null });
  try {
    if (config.require_review && config.review_channel_id) {
      const card = reviewCard(row, config, { pictureName: picture?.name });
      if (picture) card.files = [new AttachmentBuilder(picture.buffer, { name: picture.name })];
      const message = await sendAnonymous(channel, config, card, { name: 'Confessions review' });
      row = await db.update(row.id, { review_channel_id: channel.id, review_message_id: message.id, image_url: message.attachments?.first?.()?.url ?? row.image_url });
      return { row, review: true };
    }
    row = await publish(guild, row, config, picture);
    return { row, message: { url: `https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id}` } };
  } catch (err) {
    logger.warn(`A confession could not be posted in ${guild.id}: ${err.message}`);
    await db.remove(guild.id, row.id).catch(() => {});
    return { error: 'I could not post the confession. Ask the staff to check my permissions in the channel.' };
  }
}

/** The staff approves or rejects a confession that waits. Returns `{ error }` or `{ row }`. */
async function decide({ guild, member, id, approve }) {
  const config = await db.getConfig(guild.id);
  if (!isStaff(member, config)) return { error: 'Only the staff can do this.' };
  const row = await db.getById(id);
  if (!row || row.guild_id !== guild.id) return { error: 'That confession does not exist any more.' };
  if (row.status !== 'pending') return { error: `That confession was already ${row.status === 'posted' ? 'approved' : row.status}.` };
  let updated;
  if (approve) {
    try {
      const own = /^https?:\/\//.test(row.image_url ?? '') ? await takePicture(row.image_url) : null;
      updated = await publish(guild, row, config, own);
    } catch (err) {
      logger.warn(`A confession could not be published in ${guild.id}: ${err.message}`);
      return { error: 'I could not post it. Check my permissions in the confessions channel.' };
    }
  } else {
    updated = await db.update(id, { status: 'rejected', reviewed_by: member.id });
  }
  if (approve) updated = await db.update(id, { reviewed_by: member.id });
  await logAction(guild, config, `${member} ${approve ? 'approved' : 'rejected'} the confession \`${id}\` (#${row.number}).`, approve ? config.color : RED);
  return { row: updated, config };
}

/** An anonymous reply to a confession, in a thread of it. Returns `{ error }` or `{ row }`. */
async function reply({ guild, user, id, text }) {
  const config = await db.getConfig(guild.id);
  if (!config.enabled || !config.allow_replies) return { error: 'Anonymous replies are not turned on in this server.' };
  if (await db.isBlocked(guild.id, user.id)) return { error: 'You cannot make confessions in this server.' };
  const parent = await db.getById(id);
  if (!parent || parent.guild_id !== guild.id || parent.status !== 'posted') return { error: 'That confession is not there any more.' };
  const content = String(text ?? '').trim();
  if (!content) return { error: 'Write your reply first.' };
  if (content.length > MAX_CONTENT) return { error: `A reply can have up to ${MAX_CONTENT} letters.` };
  if (config.cooldown_seconds > 0) {
    const last = await db.lastBy(guild.id, user.id);
    const wait = last ? Math.ceil((last.getTime() + config.cooldown_seconds * 1000 - Date.now()) / 1000) : 0;
    if (wait > 0) return { error: `Wait ${wait} second${wait === 1 ? '' : 's'} before the next one.` };
  }
  const channel = await guild.channels.fetch(parent.channel_id).catch(() => null);
  const message = channel?.isTextBased?.() ? await channel.messages.fetch(parent.message_id).catch(() => null) : null;
  if (!message) return { error: 'I cannot find that confession any more.' };
  let thread = parent.thread_id ? await guild.channels.fetch(parent.thread_id).catch(() => null) : null;
  if (!thread) {
    try {
      thread = await message.startThread({ name: `Confession #${parent.number}`.slice(0, 100), autoArchiveDuration: 1440 });
      await db.update(parent.id, { thread_id: thread.id });
    } catch (err) {
      logger.warn(`The thread of a confession could not be made in ${guild.id}: ${err.message}`);
      return { error: 'I could not open the thread of that confession. Ask the staff to check my permissions.' };
    }
  }
  const row = await db.create({ id: makeId(), guild_id: guild.id, number: await db.nextNumber(guild.id), author_id: config.keep_author ? user.id : null, content, status: 'posted', channel_id: thread.id, reply_to: parent.id });
  try {
    const payload = await render(guild, row, config, { reply: true });
    const sent = await sendAnonymous(thread, config, payload);
    await db.update(row.id, { message_id: sent.id });
  } catch (err) {
    logger.warn(`An anonymous reply could not be posted in ${guild.id}: ${err.message}`);
    await db.remove(guild.id, row.id).catch(() => {});
    return { error: 'I could not post the reply.' };
  }
  return { row, thread };
}

module.exports = { BUTTON_PREFIX, MAX_CONTENT, makeId, confessionVars, defaultDesign, render, avatarFor, sendAnonymous, buildPanel, postPanel, bumpPanel, logAction, isStaff, publish, reviewCard, submit, decide, reply };
