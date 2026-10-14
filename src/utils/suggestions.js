// Suggestions: a member suggests something, the server votes with two buttons, and the staff answers. The message of a suggestion is a
// saved design of the server (with the {suggestion.*} variables) or, when none is chosen, the usual one below: a container with the
// suggestion, who made it, the votes so far and the ID. The two vote buttons are always put under it.
const crypto = require('node:crypto');
const { PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const db = require('../db/suggestions');
const { build } = require('./embedBuilder');
const { templatePayload } = require('./templatedMessage');
const logger = require('./logger');
const { fetchImageBuffer } = require('./safeImage');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MAX_CONTENT = 1800;
const MAX_PER_HOUR = 5;
const BUTTON_PREFIX = 'sug';

const STATUSES = {
  pending: { label: 'Pending', color: 'color_pending' },
  approved: { label: 'Approved', color: 'color_approved' },
  denied: { label: 'Denied', color: 'color_denied' },
  considering: { label: 'Under consideration', color: 'color_considering' },
  implemented: { label: 'Implemented', color: 'color_implemented' },
};
const CLOSED = new Set(['approved', 'denied', 'implemented']);

/** An ID like `si2tr-foytm`: two groups of five letters and numbers. */
function makeId() {
  const part = () => Array.from({ length: 5 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
}

const IMAGE_URL = /https?:\/\/\S+?\.(?:png|jpe?g|gif|webp)(?:\?\S*)?(?=\s|$)/i;

/** The text of a suggestion and its picture: an attached image, or a link to one written in the text. */
function splitImage(text, attachments = []) {
  let content = String(text ?? '').trim();
  const list = Array.isArray(attachments) ? attachments : [...(attachments?.values?.() ?? [])];
  const attached = list.find((file) => String(file?.contentType ?? '').startsWith('image/'));
  if (attached) return { content, imageUrl: attached.url };
  const match = IMAGE_URL.exec(content);
  if (match) {
    content = content.replace(match[0], '').replace(/[ \t]{2,}/g, ' ').trim();
    return { content, imageUrl: match[0] };
  }
  return { content, imageUrl: null };
}

/** An emoji as a button takes it: a custom `<:name:id>` or a plain one. */
function parseEmoji(text, fallback) {
  const raw = String(text ?? '').trim() || fallback;
  const custom = /^<(a?):(\w+):(\d+)>$/.exec(raw);
  return custom ? { id: custom[3], name: custom[2], animated: custom[1] === 'a' } : { name: raw };
}

function voteRow(id, config) {
  return {
    type: 1,
    components: [
      { type: 2, style: 2, custom_id: `${BUTTON_PREFIX}:up:${id}`, emoji: parseEmoji(config.up_emoji, '<:Pe_nerdSuccess:1559577139328847963>') },
      { type: 2, style: 2, custom_id: `${BUTTON_PREFIX}:down:${id}`, emoji: parseEmoji(config.down_emoji, '<:Pe_nerdError:1559577090586841188>') },
    ],
  };
}

/** The usual look, written as a design of the dashboard so the saved ones can change any part of it. */
function defaultDesign(config, status) {
  const children = [
    { type: 10, content: '**Suggestion**\n{suggestion.content}' },
    { type: 12, items: [{ media: { url: '{suggestion.image}' } }] },
    { type: 14, divider: true, spacing: 1 },
    config.anonymous
      ? { type: 10, content: '**Submitter**\nAnonymous' }
      : { type: 9, components: [{ type: 10, content: '**Submitter**\n{suggestion.author_name} ({suggestion.author})' }], accessory: { type: 11, media: { url: '{suggestion.author_avatar}' } } },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: '**Results So Far**\n{suggestion.up_emoji}: **{suggestion.up}**\n{suggestion.down_emoji}: **{suggestion.down}**' },
  ];
  if (status !== 'pending') children.push({ type: 10, content: '**{suggestion.status_label}** by {suggestion.staff}\n{suggestion.reason}' });
  children.push({ type: 10, content: 'Suggestion ID: `{suggestion.id}` | Created {suggestion.created}' });
  return { v2: { components: [{ type: 17, accent_color: config.status_colors ? config[STATUSES[status].color] : null, components: children }] } };
}

/** The kind of picture and its file name, from the first bytes; null when it is not a picture Discord shows. */
function pictureName(buffer) {
  if (buffer.length > 12 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'suggestion.png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'suggestion.jpg';
  if (buffer.length > 6 && buffer.toString('latin1', 0, 4) === 'GIF8') return 'suggestion.gif';
  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'suggestion.webp';
  return null;
}

/**
 * The picture of a suggestion as a file of its own message. The link the member gave (usually the attachment of their own message, which is
 * deleted right after) stops working, so the picture is copied now and the suggestion keeps it. null when it cannot be had.
 */
async function copyPicture(url) {
  try {
    const buffer = await fetchImageBuffer(url);
    const name = pictureName(buffer);
    return name ? { buffer, name } : null;
  } catch (err) {
    logger.warn(`The picture of a suggestion could not be copied: ${err.message}`);
    return null;
  }
}

/** What `{suggestion.*}` says about one suggestion. */
function suggestionVars(row, config, { guild, tally, author, staffName }) {
  const total = tally.up + tally.down;
  const anonymous = Boolean(config.anonymous);
  return {
    id: row.id,
    number: row.number,
    content: row.content,
    status: row.status,
    statusLabel: row.status === 'pending' ? '' : STATUSES[row.status]?.label ?? '',
    reason: row.status_reason ?? '',
    staffId: row.status_by ?? '',
    staffName: staffName ?? '',
    author: anonymous
      ? { id: '', name: 'Anonymous', avatar: '' }
      : { id: row.author_id, name: author?.displayName ?? author?.globalName ?? author?.username ?? 'Unknown user', avatar: author?.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? '' },
    up: tally.up,
    down: tally.down,
    upEmoji: config.up_emoji,
    downEmoji: config.down_emoji,
    score: tally.up - tally.down,
    percent: total ? Math.round((tally.up / total) * 100) : 0,
    image: row.image_url ?? '',
    link: row.message_id && row.channel_id ? `https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id}` : '',
    channelId: row.channel_id ?? '',
    threadId: row.thread_id ?? '',
    unix: Math.floor(new Date(row.created_at).getTime() / 1000),
  };
}

/** The message of a suggestion, ready to send or to edit with. */
async function render(guild, row, config, { tally = null, authorUser = null } = {}) {
  const votes = tally ?? await db.tally(row.id);
  const author = guild.members.cache.get(row.author_id) ?? authorUser ?? await guild.client.users.fetch(row.author_id).catch(() => null);
  let staffName = '';
  if (row.status_by) staffName = guild.members.cache.get(row.status_by)?.displayName ?? (await guild.client.users.fetch(row.status_by).catch(() => null))?.username ?? '';
  const own = /^attachment:\/\/([\w.-]+)$/.exec(row.image_url ?? '');
  const ctx = { guild, user: author?.user ?? author ?? undefined, member: guild.members.cache.get(row.author_id) ?? undefined, suggestion: suggestionVars(row, config, { guild, tally: votes, author, staffName }), attachmentNames: new Set(own ? [own[1]] : []) };
  const color = config[STATUSES[row.status]?.color ?? 'color_pending'];

  let payload = null;
  if (config.embed_template) payload = await templatePayload(guild.id, config.embed_template, ctx);
  if (payload) {
    // With the colors on, the status shows in the color: a saved design keeps its own while the suggestion is pending. With them off
    // (the usual) nothing is painted.
    if (config.status_colors) {
      const first = (payload.components ?? []).find((component) => component?.type === 17);
      if (first && (row.status !== 'pending' || first.accent_color == null)) first.accent_color = color;
      if (!first && row.status !== 'pending') payload.embeds?.[0]?.setColor?.(color);
    }
  } else {
    const built = await build(defaultDesign(config, row.status), { ...ctx, allowV2: true });
    payload = { content: undefined, embeds: [], components: built.components, files: built.files ?? [], flags: built.flags };
  }
  return {
    content: payload.content || undefined,
    embeds: payload.embeds ?? [],
    components: [...(payload.components ?? []), voteRow(row.id, config)],
    files: payload.files ?? [],
    ...(payload.flags ? { flags: payload.flags } : {}),
    allowedMentions: { parse: [] },
  };
}

/** True for who can answer suggestions: Manage Server, or the staff role of the server. */
function isStaff(member, config) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return Boolean(config?.staff_role_id && member.roles?.cache?.has(config.staff_role_id));
}

const threadTitle = (config, row) => String(config.thread_name || 'Thread for suggestion {suggestion.id}')
  .replaceAll('{suggestion.id}', row.id).replaceAll('{suggestion.number}', String(row.number)).replaceAll('{suggestion.status}', row.status).slice(0, 100) || `Suggestion ${row.id}`;

/**
 * Makes a suggestion and posts it. Returns `{ error }` with something to tell the member, or `{ row, message }`.
 * `attachments` are the files of the message the member wrote, if any.
 */
async function submit({ guild, user, text, attachments = [] }) {
  const config = await db.getConfig(guild.id);
  if (!config.enabled || !config.channel_id) return { error: 'Suggestions are not turned on in this server.' };
  if (await db.isBlocked(guild.id, user.id)) return { error: 'You cannot make suggestions in this server.' };
  const { content, imageUrl } = splitImage(text, attachments);
  if (!content && !imageUrl) return { error: 'Write your suggestion first.' };
  if (content.length > MAX_CONTENT) return { error: `A suggestion can have up to ${MAX_CONTENT} letters. Yours has ${content.length}.` };
  if ((await db.countRecent(guild.id, user.id, 1)) >= MAX_PER_HOUR) return { error: `You made ${MAX_PER_HOUR} suggestions in the last hour. Wait a little before the next one.` };
  const channel = await guild.channels.fetch(config.channel_id).catch(() => null);
  if (!channel?.isTextBased?.() || channel.isThread?.()) return { error: 'The channel for suggestions is not there any more. Ask the staff to pick it again.' };
  const me = guild.members.me;
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return { error: `I cannot write in ${channel}. Ask the staff to give me access.` };

  const id = makeId();
  // The picture is copied and sent with the suggestion: the link of the member's message dies when that message is deleted.
  const picture = imageUrl ? await copyPicture(imageUrl) : null;
  let row = await db.createSuggestion({ id, guild_id: guild.id, number: await db.nextNumber(guild.id), channel_id: channel.id, author_id: user.id, content: content || '*(a picture)*', image_url: picture ? `attachment://${picture.name}` : imageUrl });
  let message;
  try {
    const payload = await render(guild, row, config, { tally: { up: 0, down: 0, mine: 0 }, authorUser: user });
    if (picture) payload.files = [...(payload.files ?? []), new AttachmentBuilder(picture.buffer, { name: picture.name })];
    message = await channel.send(payload);
  } catch (err) {
    logger.warn(`A suggestion could not be posted in ${guild.id}: ${err.message}`);
    await db.deleteSuggestion(guild.id, id).catch(() => {});
    return { error: 'I could not post the suggestion. Ask the staff to check my permissions in the channel.' };
  }
  row = await db.updateSuggestion(id, { message_id: message.id });
  if (config.thread && channel.permissionsFor(me)?.has(PermissionFlagsBits.CreatePublicThreads)) {
    try {
      const thread = await message.startThread({ name: threadTitle(config, row), autoArchiveDuration: 1440 });
      row = await db.updateSuggestion(id, { thread_id: thread.id });
      await refresh(guild, row, config, { tally: { up: 0, down: 0, mine: 0 }, authorUser: user });
    } catch (err) {
      logger.warn(`The thread of a suggestion could not be made in ${guild.id}: ${err.message}`);
    }
  }
  return { row, message };
}

/** Draws the message of a suggestion again (after a vote, an answer or a change of the design). */
async function refresh(guild, row, config, options = {}) {
  const channel = row.channel_id ? await guild.channels.fetch(row.channel_id).catch(() => null) : null;
  const message = channel?.isTextBased?.() && row.message_id ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
  if (!message) return null;
  // The picture of the suggestion is a file of the message: it has to be kept or the edit says the attachment was not found.
  const payload = await render(guild, row, config, options);
  if (message.attachments?.size) payload.attachments = [...message.attachments.values()];
  await message.edit(payload).catch((err) => logger.warn(`A suggestion could not be edited in ${guild.id}: ${err.message}`));
  return message;
}

/** A vote from a button: the same vote again takes it back, the other one changes it. Returns `{ error }` or `{ row, changed }`. */
async function vote({ guild, member, id, direction }) {
  const row = await db.getById(id);
  if (!row || row.guild_id !== guild.id) return { error: 'That suggestion does not exist any more.' };
  const config = await db.getConfig(guild.id);
  if (CLOSED.has(row.status)) return { error: `This suggestion is closed (${STATUSES[row.status].label.toLowerCase()}), so it takes no more votes.` };
  if (!config.self_vote && row.author_id === member.id) return { error: 'You cannot vote on your own suggestion.' };
  const current = (await db.tally(id, member.id)).mine;
  const wanted = direction === 'up' ? 1 : -1;
  await db.setVote(id, member.id, current === wanted ? 0 : wanted);
  return { row, config };
}

/** An answer from the staff: approve, deny, consider or mark as implemented. Returns `{ error }` or `{ row }`. */
async function answer({ guild, member, id, status, reason }) {
  const config = await db.getConfig(guild.id);
  if (!isStaff(member, config)) return { error: 'Only the staff can answer suggestions.' };
  if (!STATUSES[status]) return { error: 'That is not a status.' };
  const row = await db.getSuggestion(guild.id, id);
  if (!row) return { error: `There is no suggestion with the ID \`${id}\` in this server.` };
  const updated = await db.updateSuggestion(id, { status, status_reason: String(reason ?? '').slice(0, 1000) || null, status_by: member.id });
  await refresh(guild, updated, config);
  if (updated.thread_id && status !== 'pending') {
    const thread = await guild.channels.fetch(updated.thread_id).catch(() => null);
    if (thread?.isThread?.() && CLOSED.has(status)) thread.send({ content: `This suggestion was marked as **${STATUSES[status].label.toLowerCase()}** by ${member}.${updated.status_reason ? `\n> ${updated.status_reason}` : ''}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  if (config.dm_author && status !== 'pending') {
    const author = await guild.client.users.fetch(updated.author_id).catch(() => null);
    const link = updated.message_id && updated.channel_id ? `https://discord.com/channels/${guild.id}/${updated.channel_id}/${updated.message_id}` : '';
    author?.send({ content: `Your suggestion in **${guild.name}** was marked as **${STATUSES[status].label.toLowerCase()}**.${updated.status_reason ? `\n> ${updated.status_reason}` : ''}${link ? `\n${link}` : ''}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return { row: updated };
}

/** Deletes a suggestion, its message and its thread. */
async function remove({ guild, member, id }) {
  const config = await db.getConfig(guild.id);
  if (!isStaff(member, config)) return { error: 'Only the staff can delete suggestions.' };
  const row = await db.deleteSuggestion(guild.id, id);
  if (!row) return { error: `There is no suggestion with the ID \`${id}\` in this server.` };
  const channel = row.channel_id ? await guild.channels.fetch(row.channel_id).catch(() => null) : null;
  if (channel?.isTextBased?.() && row.message_id) await channel.messages.delete(row.message_id).catch(() => {});
  if (row.thread_id) await (await guild.channels.fetch(row.thread_id).catch(() => null))?.delete?.().catch(() => {});
  return { row };
}

/** Who voted a suggestion: the IDs in favor and against, newest first as stored. Returns `{ error }` or `{ row, up, down }`. */
async function voters({ guild, member, id }) {
  const config = await db.getConfig(guild.id);
  if (!isStaff(member, config)) return { error: 'Only the staff can see who voted.' };
  const row = await db.getSuggestion(guild.id, String(id).trim().toLowerCase());
  if (!row) return { error: `There is no suggestion with the ID \`${id}\` in this server.` };
  const votes = await db.getVotes(row.id);
  return { row, up: votes.filter((v) => v.vote === 1).map((v) => v.user_id), down: votes.filter((v) => v.vote === -1).map((v) => v.user_id) };
}

module.exports = { pictureName, BUTTON_PREFIX, STATUSES, CLOSED, MAX_CONTENT, makeId, splitImage, parseEmoji, voteRow, defaultDesign, suggestionVars, render, refresh, isStaff, submit, vote, voters, answer, remove };
