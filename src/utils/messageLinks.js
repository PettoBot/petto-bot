// i18n-ignore-file: the reasons of a refusal and the log lines are for the team, never shown in Discord
// Message link embeds: when a member posts the link of a message of the same server, Petto answers with an embed of that message,
// but only for a server that turned it on (`!messagelinks on`), only for what the member can already see, and it keeps nothing.
//
// The rules, all of them checked before anything is shown:
//   - the link is of this server, in a channel (or thread) the member has View Channel and Read Message History in, and so has Petto;
//   - an NSFW channel is never opened in a channel that is not NSFW; an ignored channel is neither read nor opened;
//   - not inside code, not `<https://...>`, not in a spoiler, not from a bot, not the message that holds the link, at most 3 a message;
//   - a cooldown of 3 seconds per channel (the only limit besides the 3 links a message: nothing depends on a plan); the answer never
//     pings anybody and the member's message is never touched.
// Memory: the linked message is read once (the cache of the channel first, then one fetch that is not kept), the strings are clipped before
// the embed is built, and the only state is the cooldown map, which is bounded and forgets what has expired.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, MessageType, PermissionFlagsBits,
} = require('discord.js');
const { COLORS } = require('./colors');
const { t } = require('../i18n');

const MAX_LINKS = 3;
const CHANNEL_COOLDOWN_MS = 3000;
const MAX_COOLDOWN_ENTRIES = 1000;
const MAX_ATTACHMENTS_SEEN = 10;
const MAX_EMBEDS_SEEN = 4;
const DESCRIPTION_LIMIT = 4096;
const FIELD_LIMIT = 1024;
const LINK = /https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})(?![\dA-Za-z_])/gi;
const READ = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
// What a member can post that is worth opening: a normal message or a reply.
const ALLOWED_TYPES = new Set([MessageType.Default, MessageType.Reply, MessageType.ChatInputCommand, MessageType.ContextMenuCommand]);
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i;

/** The text with the parts where a link must not be opened blanked out (same length): code blocks, inline code and spoilers. */
function blankProtected(content) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return String(content ?? '')
    .replace(/```[\s\S]*?(```|$)/g, blank)
    .replace(/(`+)[\s\S]*?\1/g, blank)
    .replace(/\|\|[\s\S]*?\|\|/g, blank);
}

/**
 * The message links of a text, in order, without repeats, at most `max`: `[{ guildId, channelId, messageId, url }]`.
 * Hosts discord.com and discordapp.com, also ptb. and canary.; a trailing `.`, `,`, `)` or `*` is not part of the link, a link in a
 * markdown `[text](link)` is found, and `<link>` (the way to ask Discord for no preview), code and spoilers are left out.
 */
/** The cheap first look: a text with no `discord` and `/channels/` in it has no link to open (nothing is allocated). */
const mayHaveLink = (content) => typeof content === 'string' && content.includes('/channels/') && content.includes('discord');

function extractMessageLinks(content, max = MAX_LINKS) {
  if (!mayHaveLink(content)) return [];
  const text = blankProtected(content);
  const found = [];
  const seen = new Set();
  LINK.lastIndex = 0;
  for (let match = LINK.exec(text); match && found.length < max; match = LINK.exec(text)) {
    if (text[match.index - 1] === '<') continue;
    const [, guildId, channelId, messageId] = match;
    const key = `${guildId}/${channelId}/${messageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ guildId, channelId, messageId, url: `https://discord.com/channels/${key}` });
  }
  return found;
}

/** Whether a channel is NSFW; a thread is as its parent. */
function isNsfwChannel(channel) {
  if (!channel) return false;
  const source = channel.isThread?.() ? channel.parent : channel;
  return Boolean(source?.nsfw);
}

/** Whether a channel or its parent (for a thread) is one of the ignored ones. */
function isIgnored(channel, ignored) {
  if (!channel || !ignored?.length) return false;
  return ignored.includes(String(channel.id)) || Boolean(channel.parentId && ignored.includes(String(channel.parentId)));
}

/**
 * Whether a member (a poster, or Petto itself) can read a channel: View Channel and Read Message History there, counting the
 * overwrites of the channel (a thread has those of its parent), and for a private thread being in it or managing threads.
 * `userId` is the member's id. Anything that cannot be found out counts as "no".
 */
async function canRead(channel, member, userId) {
  try {
    if (!channel || !member || typeof channel.permissionsFor !== 'function') return false;
    const permissions = channel.permissionsFor(member);
    if (!permissions || !permissions.has(READ)) return false;
    if (channel.type === ChannelType.PrivateThread && !permissions.has(PermissionFlagsBits.ManageThreads)) {
      const inside = await channel.members.fetch({ member: userId, cache: false, force: true });
      return Boolean(inside);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The cooldown of each channel, in memory. An entry is kept only while the cooldown runs: expired ones are dropped on the next start
 * (the Map is in order of time, so only the front is looked at) and the Map never holds more than `maxEntries`. `now` is replaceable
 * for the checks.
 */
function createLimiter({ cooldownMs = CHANNEL_COOLDOWN_MS, maxEntries = MAX_COOLDOWN_ENTRIES, now = Date.now } = {}) {
  const lastByChannel = new Map();
  const prune = (at) => {
    for (const [id, last] of lastByChannel) {
      if (at - last < cooldownMs && lastByChannel.size <= maxEntries) break;
      lastByChannel.delete(id);
    }
  };
  return {
    /** Checks and starts the cooldown of a channel in one step: false when it is still running. */
    tryStart(channelId) {
      const at = now();
      const last = lastByChannel.get(channelId);
      if (last !== undefined && at - last < cooldownMs) return false;
      lastByChannel.delete(channelId);
      lastByChannel.set(channelId, at);
      prune(at);
      return true;
    },
    cooldownActive(channelId) {
      const last = lastByChannel.get(channelId);
      return last !== undefined && now() - last < cooldownMs;
    },
    size: () => lastByChannel.size,
  };
}

const clip = (value, limit) => {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};
const isHttps = (value) => typeof value === 'string' && /^https:\/\//i.test(value);

function isImageAttachment(attachment) {
  if (!isHttps(attachment?.url)) return false;
  if (attachment.spoiler === true || /^SPOILER_/i.test(attachment.name ?? '')) return false; // a spoiler stays a link
  return String(attachment.contentType ?? '').startsWith('image/') || IMAGE_NAME.test(attachment.name ?? attachment.url);
}

const valuesOf = (collection) => (collection ? [...(typeof collection.values === 'function' ? collection.values() : collection)] : []);

/** The embed of a message: `{ embed, button }`. `link` is the parsed link, `channel` the channel of the message. */
function buildLinkEmbed(target, { link, channel, lang, number = null }) {
  const attachments = valuesOf(target.attachments).slice(0, MAX_ATTACHMENTS_SEEN);
  const images = attachments.filter(isImageAttachment);
  const mainImage = images[0] ?? null;
  const embedImages = valuesOf(target.embeds).slice(0, MAX_EMBEDS_SEEN)
    .map((embed) => embed?.image?.url ?? embed?.thumbnail?.url)
    .filter(isHttps);

  const author = target.member?.displayName ?? target.author?.globalName ?? target.author?.username ?? t(lang, 'messagelinks.unknownUser');
  const avatar = target.member?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? target.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null;

  const head = [];
  const reference = target.reference;
  if (reference?.messageId && target.type === MessageType.Reply) {
    const name = target.mentions?.repliedUser?.globalName ?? target.mentions?.repliedUser?.username ?? null;
    const sameGuild = !reference.guildId || reference.guildId === link.guildId;
    const where = sameGuild ? `https://discord.com/channels/${link.guildId}/${reference.channelId ?? link.channelId}/${reference.messageId}` : null;
    const label = name ? t(lang, 'messagelinks.replying', { name }) : t(lang, 'messagelinks.replyingUnknown');
    head.push(`-# ↩ ${where ? `[${label}](${where})` : label}`);
  }
  const tail = [];
  for (const sticker of valuesOf(target.stickers)) tail.push(`-# ${t(lang, 'messagelinks.sticker', { name: sticker.name ?? '?' })}`);

  // The words of the message; a message of a bot with only an embed shows the title and the text of that embed.
  let text = String(target.content ?? '').slice(0, DESCRIPTION_LIMIT + 1);
  if (!text.trim()) {
    const first = valuesOf(target.embeds).slice(0, MAX_EMBEDS_SEEN).find((embed) => embed?.title || embed?.description);
    if (first) text = [first.title ? `**${first.title}**` : '', first.description ?? ''].filter(Boolean).join('\n');
  }
  const frame = [...head, ...tail].join('\n');
  const room = DESCRIPTION_LIMIT - frame.length - (head.length ? 1 : 0) - (tail.length ? 1 : 0);
  const body = clip(text, Math.max(0, room));
  let description = [head.join('\n'), body, tail.join('\n')].filter(Boolean).join('\n');
  if (!description && !mainImage && !embedImages.length && !attachments.length) description = t(lang, 'messagelinks.noText');

  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setAuthor({ name: clip(author, 256), ...(avatar ? { iconURL: avatar } : {}), url: link.url })
    .setFooter({ text: clip(`#${channel?.name ?? ''}`, 2048) })
    .setTimestamp(target.createdTimestamp ?? Date.now());
  if (description) embed.setDescription(description);

  const picture = mainImage?.url ?? embedImages[0] ?? null;
  if (picture) embed.setImage(picture);
  const files = attachments.filter((attachment) => attachment !== mainImage && isHttps(attachment.url))
    .map((attachment) => `[${clip(attachment.name ?? t(lang, 'messagelinks.attachment'), 80)}](${attachment.url})`);
  const extraImages = (mainImage ? embedImages : embedImages.slice(1)).map((url) => `[${t(lang, 'messagelinks.embedImage')}](${url})`);
  const listed = [...files, ...extraImages];
  if (listed.length) embed.addFields({ name: t(lang, 'messagelinks.attachments'), value: clip(listed.join('\n'), FIELD_LIMIT), inline: false });

  const button = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(link.url)
    .setLabel(number ? t(lang, 'messagelinks.jumpNumber', { number }) : t(lang, 'messagelinks.jump'));
  return { embed, button };
}

const loggedOnce = new Set();
/** Says something once per server in the log (the same problem is not repeated for every message). */
function logOnce(logger, guildId, kind, text) {
  const key = `${guildId}:${kind}`;
  if (loggedOnce.has(key)) return;
  if (loggedOnce.size > 2000) loggedOnce.clear();
  loggedOnce.add(key);
  logger?.warn?.(text);
}

/**
 * What to do with a message that may hold links. Answers `{ status, reason }`: `sent` with the reply, or `skipped` with why.
 * Nothing is thrown for a normal refusal; every refusal is silent in the channel.
 * `deps`: `getSettings(guildId)`, `limiter`, `lang`, `logger`.
 */
async function expandMessageLinks(message, { getSettings, limiter, lang = 'en', logger = null } = {}) {
  const skip = (reason) => ({ status: 'skipped', reason });
  const guild = message.guild;
  if (!guild || !message.author || message.author.bot || message.webhookId || message.system) return skip('source');
  if (message.type != null && !ALLOWED_TYPES.has(message.type)) return skip('type');
  if (!mayHaveLink(message.content)) return skip('no links');
  // The server's switch comes before anything is parsed: a server with it off costs one lookup in memory.
  const settings = await getSettings(guild.id);
  if (!settings) return skip('off');
  const links = extractMessageLinks(message.content);
  if (!links.length) return skip('no links');
  const source = message.channel;
  if (!source || isIgnored(source, settings.ignored_channels)) return skip('ignored');

  const me = guild.members?.me;
  if (!me) return skip('no bot member');
  const myPermissions = source.permissionsFor?.(me);
  const canSend = myPermissions?.has(source.isThread?.() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages);
  if (!canSend) return skip('cannot send');
  if (!myPermissions.has(PermissionFlagsBits.EmbedLinks)) {
    logOnce(logger, guild.id, 'embed-links', `Message link embeds are on in guild ${guild.id}, but Petto lacks Embed Links in #${source.name}: nothing is shown there.`);
    return skip('no Embed Links');
  }
  if (limiter.cooldownActive(source.id)) return skip('cooldown');

  const poster = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!poster) return skip('no poster');

  const embeds = [];
  const buttons = [];
  let started = false;
  for (const link of links) {
    if (link.guildId !== guild.id) continue; // another server: never
    if (link.messageId === message.id) continue;
    const channel = guild.channels.cache.get(link.channelId) ?? await guild.channels.fetch(link.channelId).catch(() => null);
    if (!channel || channel.guildId !== guild.id || channel.isDMBased?.() || !channel.isTextBased?.() || !channel.messages) continue;
    if (isIgnored(channel, settings.ignored_channels)) continue;
    if (isNsfwChannel(channel) && !isNsfwChannel(source)) continue;
    if (!(await canRead(channel, poster, message.author.id))) continue;
    if (!(await canRead(channel, me, me.id ?? message.client?.user?.id))) continue;
    // The cooldown starts with the first message that is really going to be read, and the check and the start are one step.
    if (!started) {
      if (!limiter.tryStart(source.id)) return skip('cooldown');
      started = true;
    }
    // The cache of the channel first; otherwise one fetch of this message that is not kept.
    const target = channel.messages.cache?.get?.(link.messageId) ?? await channel.messages.fetch({ message: link.messageId, cache: false }).catch(() => null);
    if (!target || target.partial || target.system || target.flags?.has?.(MessageFlags.Ephemeral)) continue;
    if (target.type != null && !ALLOWED_TYPES.has(target.type)) continue;
    const built = buildLinkEmbed(target, { link, channel, lang });
    embeds.push(built.embed);
    buttons.push({ button: built.button, link });
  }
  if (!embeds.length) return skip('nothing to show');

  if (buttons.length > 1) {
    buttons.forEach((item, index) => item.button.setLabel(t(lang, 'messagelinks.jumpNumber', { number: index + 1 })));
  }
  const payload = {
    embeds,
    components: [new ActionRowBuilder().addComponents(buttons.map((item) => item.button))],
    // Nobody is notified: not the author of the shown message, not the member who posted the link.
    allowedMentions: { parse: [], repliedUser: false },
    failIfNotExists: false,
  };
  try {
    await message.reply(payload);
  } catch (error) {
    logger?.warn?.(`Message link embeds: the reply in guild ${guild.id} failed: ${error?.message ?? error}`);
    return skip('reply failed');
  }
  return { status: 'sent', count: embeds.length, payload };
}

module.exports = {
  MAX_LINKS, CHANNEL_COOLDOWN_MS, MAX_COOLDOWN_ENTRIES,
  mayHaveLink, extractMessageLinks, isNsfwChannel, isIgnored, canRead, createLimiter, buildLinkEmbed, expandMessageLinks,
};
