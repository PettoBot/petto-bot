// i18n-ignore-file: the literals left here are HTML markup only; every label people read comes from t() (tickets.html.*) in the server's language.
const { t, tn, currentLanguage, normalizeLanguage } = require('../i18n');

const MAX_MESSAGES = 2000;
// How dates are written in the transcript of each language.
const DATE_LOCALES = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };
const PLACEHOLDER = '\u0000';
const MARKDOWN_PLACEHOLDER = '\u0001';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeUrl(raw) {
  try {
    const url = new URL(String(raw ?? ''));
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    return escapeHtml(url.toString());
  } catch {
    return '';
  }
}

function collectionValues(collection) {
  return collection ? [...collection.values()] : [];
}

function formatDate(value, lang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${new Intl.DateTimeFormat(DATE_LOCALES[lang] ?? DATE_LOCALES.en, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(date)} GMT-5`;
}

function formatTime(value, lang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(DATE_LOCALES[lang] ?? DATE_LOCALES.en, { timeStyle: 'short', timeZone: 'America/Bogota' }).format(date);
}

function colorHex(value, fallback = '#8399ff') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 0xffffff) return fallback;
  return `#${Math.round(number).toString(16).padStart(6, '0')}`;
}

async function fetchAllMessages(channel) {
  const messages = [];
  let before;

  while (messages.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  return messages.reverse();
}

function renderAttachment(attachment, lang) {
  const type = String(attachment.contentType ?? '').toLowerCase();
  const name = escapeHtml(attachment.name || t(lang, 'tickets.html.attachment'));
  const url = safeUrl(attachment.url);
  if (!url) return `<div class="attachment">${name}</div>`;

  const extension = String(attachment.name ?? '').split('.').pop()?.toLowerCase();
  const isImage = type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension);
  const isVideo = type.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(extension);
  const isAudio = type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(extension);
  const spoiler = attachment.spoiler ? ' data-spoiler="true"' : '';

  if (isImage) {
    return `<figure class="media${attachment.spoiler ? ' spoiler-media' : ''}"${spoiler}><img src="${url}" alt="${name}" loading="lazy"><figcaption><a href="${url}" target="_blank" rel="noopener">${name}</a></figcaption></figure>`;
  }
  if (isVideo) return `<div class="media"${spoiler}><video src="${url}" controls preload="metadata"></video><a class="media-link" href="${url}" target="_blank" rel="noopener">${name}</a></div>`;
  if (isAudio) return `<div class="audio-attachment"${spoiler}><audio src="${url}" controls preload="metadata"></audio><a href="${url}" target="_blank" rel="noopener">${name}</a></div>`;
  return `<div class="attachment"${spoiler}><span class="file-icon" aria-hidden="true">↗</span><a href="${url}" target="_blank" rel="noopener">${name}</a></div>`;
}

const TOKEN_RE = /<a?:([\w-]+):(\d+)>|<@!?(\d+)>|<@&(\d+)>|<#(\d+)>|@(everyone|here)/g;

function renderMentionToken(full, emojiName, emojiId, userId, roleId, channelId, broadcast, guild, lang) {
  if (emojiId) {
    const extension = full.startsWith('<a:') ? 'gif' : 'png';
    const url = `https://media.discordapp.net/emojis/${emojiId}.${extension}?size=44&quality=lossless`;
    return `<img class="emoji" src="${url}" alt=":${escapeHtml(emojiName)}:" title=":${escapeHtml(emojiName)}:" loading="lazy" onerror="this.replaceWith(document.createTextNode(this.alt))">`;
  }
  if (userId) {
    const member = guild?.members?.cache?.get(userId);
    const user = guild?.client?.users?.cache?.get(userId);
    const name = member?.displayName ?? user?.globalName ?? user?.username ?? userId;
    return `<span class="mention">@${escapeHtml(name)}</span>`;
  }
  if (roleId) return `<span class="mention">@${escapeHtml(guild?.roles?.cache?.get(roleId)?.name ?? t(lang, 'tickets.html.role'))}</span>`;
  if (channelId) return `<span class="mention">#${escapeHtml(guild?.channels?.cache?.get(channelId)?.name ?? t(lang, 'tickets.html.channel'))}</span>`;
  if (broadcast) return `<span class="mention mention-broadcast">@${broadcast}</span>`;
  return escapeHtml(full);
}

const UNICODE_EMOJI_RE = /(?:[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;

function renderUnicodeEmojis(html) {
  return html.replace(UNICODE_EMOJI_RE, (emoji) => {
    const codepoints = [...emoji].map((character) => character.codePointAt(0).toString(16)).join('-');
    const url = `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${codepoints}.svg`;
    return `<img class="emoji native-emoji" src="${url}" alt="${escapeHtml(emoji)}" title="${escapeHtml(emoji)}" loading="lazy" onerror="this.replaceWith(document.createTextNode(this.alt))">`;
  });
}

function renderMarkdown(escapedText) {
  const preserved = [];
  const hold = (html) => `${MARKDOWN_PLACEHOLDER}${preserved.push(html) - 1}${MARKDOWN_PLACEHOLDER}`;

  let html = escapedText
    .replace(/```(?:([\w+-]+)\n)?([\s\S]*?)```/g, (_, language, code) => hold(`<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${code}</code></pre>`))
    .replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`))
    .replace(/\|\|([^\n]+?)\|\|/g, '<span class="spoiler">$1</span>')
    .replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="md-h2">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="md-h1">$1</div>')
    .replace(/^-# (.+)$/gm, '<div class="md-sub">$1</div>')
    .replace(/^&gt; ?(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^[-*] (.+)$/gm, '<div class="md-list-item">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/(?<![*\w])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<![_\w])_(?!_)([^_\n]+?)_(?!_)/g, '<em>$1</em>')
    .replace(/\bhttps?:\/\/[^\s<]+/g, (url) => {
      const trailing = url.match(/[.,!?)]*$/)?.[0] ?? '';
      const clean = trailing ? url.slice(0, -trailing.length) : url;
      return `<a href="${safeUrl(clean)}" target="_blank" rel="noopener">${clean}</a>${trailing}`;
    });

  return html.replace(new RegExp(`${MARKDOWN_PLACEHOLDER}(\\d+)${MARKDOWN_PLACEHOLDER}`, 'g'), (_, index) => preserved[Number(index)] ?? '');
}

function renderRichText(raw, guild, lang) {
  const placeholders = [];
  let result = '';
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match;

  while ((match = TOKEN_RE.exec(String(raw ?? '')))) {
    result += escapeHtml(String(raw).slice(lastIndex, match.index));
    placeholders.push(renderMentionToken(match[0], match[1], match[2], match[3], match[4], match[5], match[6], guild, lang));
    result += `${PLACEHOLDER}${placeholders.length - 1}${PLACEHOLDER}`;
    lastIndex = TOKEN_RE.lastIndex;
  }
  result += escapeHtml(String(raw ?? '').slice(lastIndex));

  return renderUnicodeEmojis(renderMarkdown(result)).replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_, index) => placeholders[Number(index)] ?? '');
}

function renderEmbed(embed, guild, lang) {
  const color = colorHex(embed.color);
  const authorIcon = safeUrl(embed.author?.iconURL);
  const embedUrl = safeUrl(embed.url);
  const author = embed.author?.name
    ? `<div class="embed-author">${authorIcon ? `<img src="${authorIcon}" alt="" loading="lazy">` : ''}${escapeHtml(embed.author.name)}</div>`
    : '';
  const titleText = embed.title ? renderRichText(embed.title, guild, lang) : '';
  const title = titleText ? `<div class="embed-title">${embedUrl ? `<a href="${embedUrl}" target="_blank" rel="noopener">${titleText}</a>` : titleText}</div>` : '';
  const description = embed.description ? `<div class="embed-description">${renderRichText(embed.description, guild, lang)}</div>` : '';
  const fields = (embed.fields ?? []).map((field) => `<div class="embed-field${field.inline ? ' inline' : ''}"><div class="embed-field-name">${renderRichText(field.name, guild, lang)}</div><div>${renderRichText(field.value, guild, lang)}</div></div>`).join('');
  const thumbnail = safeUrl(embed.thumbnail?.url);
  const image = safeUrl(embed.image?.url);
  const footerIcon = safeUrl(embed.footer?.iconURL);
  const provider = embed.provider?.name ? `<span class="embed-provider">${escapeHtml(embed.provider.name)}</span>` : '';
  const timestamp = embed.timestamp ? `<span class="embed-timestamp">${escapeHtml(formatDate(embed.timestamp, lang))}</span>` : '';
  const video = safeUrl(embed.video?.url);

  return `<article class="embed" style="--embed-color:${color}">
    <div class="embed-main">
      ${author}${title}${provider}${description}${fields ? `<div class="embed-fields">${fields}</div>` : ''}
      ${image ? `<img class="embed-image" src="${image}" alt="" loading="lazy">` : ''}
      ${video ? `<a class="embed-video" href="${video}" target="_blank" rel="noopener">${escapeHtml(t(lang, 'tickets.html.openVideo'))}</a>` : ''}
      ${embed.footer?.text || timestamp ? `<div class="embed-footer">${footerIcon ? `<img src="${footerIcon}" alt="" loading="lazy">` : ''}${embed.footer?.text ? escapeHtml(embed.footer.text) : ''}${timestamp}</div>` : ''}
    </div>
    ${thumbnail ? `<img class="embed-thumbnail" src="${thumbnail}" alt="" loading="lazy">` : ''}
  </article>`;
}

function renderSticker(sticker, lang) {
  const url = safeUrl(sticker.url || `https://cdn.discordapp.com/stickers/${sticker.id}.png`);
  const name = escapeHtml(sticker.name || t(lang, 'tickets.html.sticker'));
  if (!url) return '';
  const format = String(sticker.format ?? '').toLowerCase();
  if (format.includes('lottie') || url.endsWith('.json')) return `<div class="sticker sticker-link"><a href="${url}" target="_blank" rel="noopener">${escapeHtml(t(lang, 'tickets.html.openSticker', { name: '\u0002' })).replace('\u0002', name)}</a></div>`;
  return `<figure class="sticker"><img src="${url}" alt="${name}" loading="lazy"><figcaption>${name}</figcaption></figure>`;
}

function renderComponent(component, guild, lang) {
  const c = typeof component?.toJSON === 'function' ? component.toJSON() : component;
  if (!c) return '';
  if (c.type === 10 && c.content) return `<div class="component-text">${renderRichText(c.content, guild, lang)}</div>`;
  if (c.type === 9) return `<div class="component-section">${(c.components ?? []).map((child) => renderComponent(child, guild, lang)).join('')}${c.accessory ? `<div class="component-accessory">${renderComponent(c.accessory, guild, lang)}</div>` : ''}</div>`;
  if (c.type === 17) return `<div class="component-container">${(c.components ?? []).map((child) => renderComponent(child, guild, lang)).join('')}</div>`;
  if (c.type === 12) return `<div class="media-gallery${(c.items ?? []).length === 1 ? ' single' : ''}">${(c.items ?? []).map((item) => { const url = safeUrl(item.media?.url || item.url); return url ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(item.description || '')}" loading="lazy"></a>` : ''; }).join('')}</div>`;
  if (c.type === 13) { const url = safeUrl(c.file?.url || c.url); const size = fileSize(c.size); return url ? `<div class="attachment"><span class="file-icon" aria-hidden="true">↗</span><a href="${url}" target="_blank" rel="noopener">${escapeHtml(c.name || t(lang, 'tickets.html.file'))}</a>${size ? ` <span class="media-link">${escapeHtml(size)}</span>` : ''}</div>` : ''; }
  if (c.type === 11) { const url = safeUrl(c.media?.url || c.url); return url ? `<img class="component-thumb" src="${url}" alt="${escapeHtml(c.description || '')}" loading="lazy">` : ''; }
  if (c.type === 14) return '<div class="component-separator" aria-hidden="true"></div>';
  if (c.type === 2) {
    const emoji = c.emoji?.id ? `<img class="emoji" src="https://media.discordapp.net/emojis/${escapeHtml(c.emoji.id)}.${c.emoji.animated ? 'gif' : 'png'}?size=44&quality=lossless" alt="" loading="lazy">` : c.emoji?.name ? renderUnicodeEmojis(escapeHtml(c.emoji.name)) : '';
    const text = `${emoji}${emoji && c.label ? ' ' : ''}${escapeHtml(c.label || (emoji ? '' : t(lang, c.url ? 'tickets.html.openLink' : 'tickets.html.button')))}`;
    return c.url ? `<a class="component-button" href="${safeUrl(c.url)}" target="_blank" rel="noopener">${text}</a>` : `<span class="component-button disabled">${text}</span>`;
  }
  if (Array.isArray(c.components)) return c.components.map((child) => renderComponent(child, guild, lang)).join('');
  return '';
}

/** A link without what comes after `?` or `#`: Discord signs its file links differently each time, the path is what stays. */
function linkKey(raw) {
  try {
    const url = new URL(String(raw ?? ''));
    return `${url.host}${url.pathname}`;
  } catch {
    return '';
  }
}

/**
 * The files a message already shows inside its components (the pictures of a media gallery, a file card, a thumbnail), as the keys of their
 * links. A message that carries files for its components (the answers of a ticket form) lists them again among its attachments, and the
 * transcript would draw each one twice.
 */
function shownByComponents(components) {
  const keys = new Set();
  const visit = (component) => {
    const c = typeof component?.toJSON === 'function' ? component.toJSON() : component;
    if (!c) return;
    if (c.type === 12) for (const item of c.items ?? []) keys.add(linkKey(item.media?.url || item.url));
    if (c.type === 13) keys.add(linkKey(c.file?.url || c.url));
    if (c.type === 11) keys.add(linkKey(c.media?.url || c.url));
    if (c.accessory) visit(c.accessory);
    for (const child of c.components ?? []) visit(child);
  };
  for (const component of collectionValues(components)) visit(component);
  keys.delete('');
  return keys;
}

/** A size for people: 512 B, 1.5 KB, 3.2 MB. */
function fileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderComponents(components, guild, lang) {
  return collectionValues(components).map((component) => renderComponent(component, guild, lang)).join('');
}

function renderReaction(reaction) {
  const emoji = reaction.emoji;
  const id = emoji?.id;
  const emojiHtml = id
    ? `<img class="reaction-emoji" src="https://media.discordapp.net/emojis/${id}.${emoji.animated ? 'gif' : 'png'}?size=44&quality=lossless" alt="${escapeHtml(emoji.name || 'emoji')}" loading="lazy" onerror="this.replaceWith(document.createTextNode(this.alt))">`
    : escapeHtml(emoji?.name || '•');
  return `<span class="reaction">${emojiHtml}<b>${Number(reaction.count ?? 0)}</b></span>`;
}


/** A Discord picture link of a user or a member (a member's own server picture first), or ''. */
function pictureOf(target, size = 128) {
  try {
    const url = target?.displayAvatarURL?.({ extension: 'png', size }) ?? '';
    return safeUrl(url);
  } catch {
    return '';
  }
}

/**
 * How Petto looks in this server: the name and picture of its own member (a nickname, and the avatar and banner a server
 * with Premium gives it), else its global ones. Snapshotted when the transcript is made, so the page keeps that look.
 */
function resolveBotIdentity(guild, client = guild?.client) {
  const me = guild?.members?.me ?? null;
  const user = me?.user ?? client?.user ?? null;
  if (!user) return null;
  const name = String(me?.nickname || user.globalName || user.username || 'Petto').slice(0, 80);
  let banner = '';
  try { banner = safeUrl(me?.bannerURL?.({ extension: 'png', size: 600 }) ?? ''); } catch { banner = ''; }
  return {
    id: user.id,
    name,
    avatarUrl: pictureOf(me?.avatar ? me : user) || pictureOf(user),
    bannerUrl: banner,
    custom: Boolean(me?.avatar || me?.nickname || me?.banner),
  };
}

/**
 * The name, picture and color a message is shown with, as Discord showed it: a webhook message with the name and picture it was
 * sent with (Petto's own looks per kind of message go through one), Petto's messages with its look in this server, and a member
 * with their server name, server picture and role color.
 */
function authorLook(msg, bot, lang) {
  const author = msg.author ?? null;
  if (msg.webhookId) {
    return { key: `webhook:${msg.webhookId}:${author?.username ?? ''}:${author?.avatar ?? ''}`, name: author?.username || t(lang, 'tickets.html.unknownUser'), avatar: pictureOf(author), color: '', bot: true };
  }
  if (bot && author?.id === bot.id) return { key: `user:${bot.id}`, name: bot.name, avatar: bot.avatarUrl || pictureOf(author), color: '', bot: true };
  const member = msg.member ?? null;
  const color = member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : '';
  return {
    key: `user:${author?.id ?? 'unknown'}`,
    name: member?.displayName ?? author?.globalName ?? author?.username ?? t(lang, 'tickets.html.unknownUser'),
    avatar: pictureOf(member?.avatar ? member : author) || pictureOf(author),
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : '',
    bot: Boolean(author?.bot),
  };
}

function renderReply(msg, messageMap, bot, lang) {
  const reference = msg.reference?.messageId ? messageMap.get(msg.reference.messageId) : null;
  if (!reference) return '';
  const look = authorLook(reference, bot, lang);
  const snippet = reference.content || t(lang, reference.embeds?.length ? 'tickets.html.snippet.embed' : reference.attachments?.size ? 'tickets.html.snippet.attachment' : 'tickets.html.snippet.message');
  const replying = escapeHtml(t(lang, 'tickets.html.replyingTo', { user: '\u0002' })).replace('\u0002', `<b>${escapeHtml(look.name)}</b>`);
  return `<a class="reply" href="#message-${escapeHtml(reference.id)}">${look.avatar ? `<img src="${look.avatar}" alt="" loading="lazy">` : ''}<span>${replying}</span><span class="reply-text">${escapeHtml(String(snippet).slice(0, 180))}</span></a>`;
}

/** "Liam used /ticket close" above the answer of a command, as Discord shows it. */
function renderInteraction(msg, lang) {
  const user = msg.interactionMetadata?.user ?? msg.interaction?.user ?? null;
  const command = msg.interaction?.commandName ?? msg.interactionMetadata?.name ?? null;
  if (!user || !command) return '';
  const member = msg.guild?.members?.cache?.get?.(user.id);
  const name = member?.displayName ?? user.globalName ?? user.username ?? t(lang, 'tickets.html.unknownUser');
  const line = escapeHtml(t(lang, 'tickets.html.usedCommand', { user: '\u0002', command: '\u0003' })).replace('\u0002', `<b>${escapeHtml(name)}</b>`).replace('\u0003', `<span class="command">/${escapeHtml(command)}</span>`);
  return `<div class="reply interaction"><span>${line}</span></div>`;
}

function renderPoll(poll, guild, lang) {
  if (!poll) return '';
  const question = poll.question?.text ?? poll.question ?? t(lang, 'tickets.html.poll');
  const answers = collectionValues(poll.answers ?? poll.answerOptions);
  if (!answers.length) return `<div class="poll"><strong>${renderRichText(question, guild, lang)}</strong></div>`;
  return `<div class="poll"><strong>${renderRichText(question, guild, lang)}</strong>${answers.map((answer) => `<div class="poll-answer"><span>${renderRichText(answer.pollMedia?.text ?? answer.text ?? t(lang, 'tickets.html.option'), guild, lang)}</span>${answer.voteCount != null ? `<b>${answer.voteCount}</b>` : ''}</div>`).join('')}</div>`;
}

const GROUP_WINDOW_MS = 7 * 60_000;
const PIN_MESSAGE_TYPE = 6;

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function renderMessage(msg, previous, messageMap, bot, lang) {
  const look = authorLook(msg, bot, lang);
  const time = formatDate(msg.createdTimestamp, lang);
  const iso = isoDate(msg.createdTimestamp);
  const messageId = escapeHtml(msg.id || 'message');

  if (msg.system && msg.type === PIN_MESSAGE_TYPE) {
    const line = escapeHtml(t(lang, 'tickets.html.pinned', { user: '\u0002' })).replace('\u0002', `<b>${escapeHtml(look.name)}</b>`);
    return `<article class="message system" id="message-${messageId}"><div class="system-icon" aria-hidden="true">📌</div><div class="message-body"><span>${line}</span> <time datetime="${escapeHtml(iso)}">${escapeHtml(time)}</time></div></article>`;
  }

  const reply = renderReply(msg, messageMap, bot, lang) || renderInteraction(msg, lang);
  const rawText = msg.content || '';
  const content = rawText ? `<div class="content">${renderRichText(rawText, msg.guild, lang)}</div>` : '';
  const components = renderComponents(msg.components, msg.guild, lang);
  const shown = shownByComponents(msg.components);
  const attachments = collectionValues(msg.attachments).filter((attachment) => !shown.has(linkKey(attachment.url))).map((attachment) => renderAttachment(attachment, lang)).join('');
  const embeds = (msg.embeds ?? []).map((embed) => renderEmbed(embed, msg.guild, lang)).join('');
  const stickers = collectionValues(msg.stickers).map((sticker) => renderSticker(sticker, lang)).join('');
  const reactions = collectionValues(msg.reactions?.cache).map(renderReaction).join('');
  const poll = renderPoll(msg.poll, msg.guild, lang);
  const hasRichContent = content || components || attachments || embeds || stickers || poll;
  const edited = msg.editedTimestamp ? `<span class="edited">${escapeHtml(t(lang, 'tickets.html.edited'))}</span>` : '';
  const body = `${content}${components}${attachments}${embeds}${stickers}${poll}${reactions ? `<div class="reactions">${reactions}</div>` : ''}${hasRichContent ? '' : `<div class="empty-content">${escapeHtml(t(lang, 'tickets.html.noText'))}</div>`}`;

  // Like Discord: the messages one person sends close together go under one name.
  const previousLook = previous && !previous.system ? authorLook(previous, bot, lang) : null;
  const grouped = !reply && previousLook?.key === look.key && Math.abs(Number(msg.createdTimestamp) - Number(previous.createdTimestamp)) < GROUP_WINDOW_MS;
  if (grouped) {
    const hhmm = formatTime(msg.createdTimestamp, lang);
    return `<article class="message grouped" id="message-${messageId}"><time class="side-time" datetime="${escapeHtml(iso)}" title="${escapeHtml(time)}" data-short="1">${escapeHtml(hhmm)}</time><div class="message-body">${body}${edited ? `<div>${edited}</div>` : ''}</div></article>`;
  }

  const botTag = look.bot ? `<span class="bot-tag">${msg.webhookId ? 'APP' : '✓ APP'}</span>` : '';
  return `<article class="message" id="message-${messageId}">
    ${reply}
    <div class="message-row">
    ${look.avatar ? `<img class="avatar" src="${look.avatar}" alt="" loading="lazy">` : '<div class="avatar avatar-fallback" aria-hidden="true"></div>'}
    <div class="message-body">
      <div class="meta"><span class="author"${look.color ? ` style="color:${look.color}"` : ''}>${escapeHtml(look.name)}</span>${botTag}<time datetime="${escapeHtml(iso)}" title="${escapeHtml(time)}">${escapeHtml(time)}</time>${edited}</div>
      ${body}
    </div>
    </div>
  </article>`;
}

/** Who wrote in the ticket, with how many messages each, most first. */
function participantsOf(messages, bot, lang) {
  const byKey = new Map();
  for (const msg of messages) {
    if (msg.system) continue;
    const look = authorLook(msg, bot, lang);
    const entry = byKey.get(look.key) ?? { ...look, count: 0 };
    entry.count += 1;
    byKey.set(look.key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

function personChip(person, lang) {
  if (!person) return `<span class="person muted">${escapeHtml(t(lang, 'tickets.html.unknownUser'))}</span>`;
  const avatar = safeUrl(person.avatar);
  return `<span class="person">${avatar ? `<img src="${avatar}" alt="" loading="lazy">` : '<span class="person-dot" aria-hidden="true"></span>'}<span>${escapeHtml(person.name ?? t(lang, 'tickets.html.unknownUser'))}</span></span>`;
}

/** A user (or member) as a small `{ name, avatar }` for the header of the page. */
function personOf(user, guild) {
  if (!user) return null;
  if (typeof user === 'string') return { name: user, avatar: '' };
  const member = guild?.members?.cache?.get?.(user.id);
  return { name: member?.displayName ?? user.globalName ?? user.username ?? user.name ?? String(user.id ?? ''), avatar: pictureOf(member?.avatar ? member : user) || user.avatar_url || '' };
}

function durationText(fromValue, toValue, lang) {
  const from = new Date(fromValue).getTime();
  const to = new Date(toValue).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return '';
  const minutes = Math.round((to - from) / 60_000);
  if (minutes < 60) return tn(lang, 'tickets.html.duration.minutes', minutes, { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return tn(lang, 'tickets.html.duration.hours', hours, { count: hours });
  const days = Math.round(hours / 24);
  return tn(lang, 'tickets.html.duration.days', days, { count: days });
}

const STYLE = `
  :root { color-scheme: dark; --bg:#1a1b1e; --surface:#232428; --surface-2:#2b2d31; --surface-3:#313338; --hover:rgba(255,255,255,.025); --border:#3a3c43; --border-soft:#2e3035; --text:#f2f3f5; --muted:#b5bac1; --dim:#80848e; --accent:#8399ff; --accent-soft:rgba(131,153,255,.16); --mention:#c9d0ff; --code:#1e1f22; --font:"gg sans","Noto Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"Apple Color Emoji","Segoe UI Emoji",sans-serif; --mono:ui-monospace,"SFMono-Regular",Consolas,monospace; }
  :root[data-theme="light"] { color-scheme: light; --bg:#f2f3f5; --surface:#ffffff; --surface-2:#f6f6f7; --surface-3:#ebedef; --hover:rgba(6,6,7,.03); --border:#dfe1e5; --border-soft:#ebedef; --text:#060607; --muted:#4e5058; --dim:#6d6f78; --accent:#5865f2; --accent-soft:rgba(88,101,242,.12); --mention:#4752c4; --code:#f2f3f5; }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { color-scheme: light; --bg:#f2f3f5; --surface:#ffffff; --surface-2:#f6f6f7; --surface-3:#ebedef; --hover:rgba(6,6,7,.03); --border:#dfe1e5; --border-soft:#ebedef; --text:#060607; --muted:#4e5058; --dim:#6d6f78; --accent:#5865f2; --accent-soft:rgba(88,101,242,.12); --mention:#4752c4; --code:#f2f3f5; } }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font:15px/1.4 var(--font); -webkit-font-smoothing:antialiased; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  .shell { width:min(1080px,calc(100% - 32px)); margin:0 auto; padding:16px 0 56px; }
  .topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 10px 8px 12px; border:1px solid var(--border); border-radius:14px; background:var(--surface); position:sticky; top:12px; z-index:4; box-shadow:0 12px 40px -28px rgba(0,0,0,.6); }
  .brand { display:flex; align-items:center; gap:10px; min-width:0; color:var(--text); font-weight:700; } .brand:hover { text-decoration:none; } .brand img { width:30px; height:30px; border-radius:50%; object-fit:cover; } .brand span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .top-actions { display:flex; gap:6px; } .top-actions button { border:1px solid var(--border); border-radius:9px; background:var(--surface-2); color:var(--text); padding:7px 11px; cursor:pointer; font:600 13px var(--font); } .top-actions button:hover { background:var(--surface-3); }
  .header { margin:20px 0 16px; border:1px solid var(--border); border-radius:16px; background:var(--surface); overflow:hidden; }
  .banner { height:110px; background:linear-gradient(135deg,var(--accent-soft),transparent) center/cover no-repeat; border-bottom:1px solid var(--border-soft); }
  .header-main { display:flex; align-items:center; gap:14px; padding:18px 20px 6px; } .guild-icon { width:56px; height:56px; flex:0 0 56px; border-radius:16px; object-fit:cover; background:var(--surface-3); display:grid; place-items:center; font-weight:700; font-size:20px; color:var(--muted); } .has-banner .guild-icon { margin-top:-46px; border:4px solid var(--surface); width:72px; height:72px; flex-basis:72px; border-radius:20px; }
  .eyebrow { color:var(--dim); font:600 11px var(--mono); letter-spacing:.1em; text-transform:uppercase; } h1 { margin:2px 0 0; font-size:clamp(22px,3.4vw,30px); line-height:1.15; letter-spacing:-.02em; } .status { display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:700; vertical-align:middle; background:rgba(242,63,67,.16); color:#f23f43; } .status.open { background:rgba(35,165,90,.16); color:#23a55a; }
  .facts { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:1px; margin-top:12px; background:var(--border-soft); border-top:1px solid var(--border-soft); } .fact { padding:11px 20px; background:var(--surface); min-width:0; } .fact dt { color:var(--dim); font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; } .fact dd { margin:3px 0 0; overflow-wrap:anywhere; }
  .person { display:inline-flex; align-items:center; gap:6px; max-width:100%; } .person img,.person-dot { width:20px; height:20px; flex:0 0 20px; border-radius:50%; object-fit:cover; background:var(--surface-3); } .person.muted { color:var(--dim); }
  .participants { display:flex; flex-wrap:wrap; gap:6px; padding:12px 20px 16px; border-top:1px solid var(--border-soft); } .participant { display:inline-flex; align-items:center; gap:6px; padding:3px 9px 3px 3px; border-radius:999px; background:var(--surface-2); font-size:13px; } .participant img,.participant .person-dot { width:22px; height:22px; border-radius:50%; } .participant b { color:var(--dim); font-weight:600; }
  .reason { padding:0 20px 14px; color:var(--muted); }
  .transcript { border:1px solid var(--border); border-radius:16px; background:var(--surface-3); overflow:hidden; }
  .notice { padding:12px 20px; border-bottom:1px solid var(--border-soft); background:rgba(240,178,50,.12); color:var(--text); }
  .messages { padding:8px 0 18px; }
  .message { padding:2px 20px 2px 16px; scroll-margin-top:90px; } .message:not(.grouped) { margin-top:14px; } .message:hover { background:var(--hover); } .message:target { background:var(--accent-soft); }
  .message-row { display:flex; gap:14px; } .avatar { width:40px; height:40px; flex:0 0 40px; margin-top:2px; border-radius:50%; object-fit:cover; background:var(--surface-2); } .avatar-fallback { border:1px solid var(--border); }
  .grouped { display:flex; gap:14px; } .side-time { width:40px; flex:0 0 40px; padding-top:3px; text-align:right; font-size:10px; opacity:0; } .grouped:hover .side-time { opacity:1; }
  .system { display:flex; gap:14px; align-items:center; color:var(--muted); font-size:14px; } .system-icon { width:40px; flex:0 0 40px; text-align:center; }
  .message-body { min-width:0; flex:1; } .meta { display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 8px; } .author { color:var(--text); font-weight:600; } time,.edited { color:var(--dim); font-size:12px; } .edited { font-size:10px; } .bot-tag { padding:1px 5px; border-radius:4px; color:#fff; background:#5865f2; font-size:10px; font-weight:700; line-height:15px; align-self:center; }
  .content { margin-top:1px; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.375; } .empty-content { color:var(--dim); font-style:italic; font-size:14px; } .emoji,.reaction-emoji { width:1.375em; height:1.375em; display:inline-block; vertical-align:-.3em; object-fit:contain; } .mention { padding:0 2px; border-radius:3px; color:var(--mention); background:var(--accent-soft); font-weight:500; } .mention-broadcast { color:#f0b232; }
  code { padding:.1em .3em; border-radius:4px; background:var(--code); font:.85em var(--mono); } pre { margin:6px 0; padding:10px 12px; max-width:90%; overflow:auto; border:1px solid var(--border); border-radius:6px; background:var(--code); white-space:pre; } pre code { padding:0; background:none; } blockquote { margin:4px 0; padding:0 12px; border-left:4px solid var(--border); } .md-h1,.md-h2,.md-h3 { margin:8px 0 2px; font-weight:700; } .md-h1 { font-size:1.5em; } .md-h2 { font-size:1.25em; } .md-h3 { font-size:1.08em; } .md-sub { color:var(--dim); font-size:12px; } .md-list-item { padding-left:16px; position:relative; } .md-list-item::before { content:"•"; position:absolute; left:2px; } .spoiler { padding:0 3px; border-radius:3px; background:var(--border); color:transparent; cursor:pointer; } .spoiler:hover { color:inherit; }
  .reply { display:flex; align-items:center; gap:6px; min-width:0; margin:0 0 3px 34px; padding-left:20px; position:relative; color:var(--dim); font-size:13px; } .reply::before { content:""; position:absolute; left:2px; top:50%; width:16px; height:10px; border-left:2px solid var(--border); border-top:2px solid var(--border); border-top-left-radius:6px; } .reply img { width:16px; height:16px; border-radius:50%; } .reply b { color:var(--muted); font-weight:600; } .reply-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; } .reply:hover { text-decoration:none; color:var(--muted); } .command { color:var(--accent); }
  .attachment,.audio-attachment { display:flex; align-items:center; gap:8px; width:fit-content; max-width:100%; margin-top:6px; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); overflow-wrap:anywhere; } .file-icon { display:grid; place-items:center; width:26px; height:26px; border-radius:6px; color:var(--accent); background:var(--accent-soft); } audio { max-width:min(420px,100%); } .media { width:fit-content; max-width:100%; margin:6px 0 0; } .media img,.media video { display:block; max-width:min(520px,100%); max-height:380px; border-radius:8px; object-fit:contain; } .media figcaption,.sticker figcaption,.media-link { display:block; margin-top:4px; color:var(--dim); font-size:11px; }
  .embed { display:flex; gap:14px; max-width:520px; margin-top:6px; padding:10px 14px 14px 12px; border-left:4px solid var(--embed-color); border-radius:4px; background:var(--surface-2); } .embed-main { min-width:0; flex:1; } .embed-author { display:flex; align-items:center; gap:7px; margin-top:4px; font-size:13px; font-weight:600; } .embed-author img,.embed-footer img { width:20px; height:20px; border-radius:50%; object-fit:cover; } .embed-title { margin-top:6px; font-size:15px; font-weight:700; } .embed-title a { color:var(--accent); } .embed-provider,.embed-timestamp { color:var(--dim); font-size:12px; } .embed-description { margin-top:6px; font-size:14px; white-space:pre-wrap; overflow-wrap:anywhere; } .embed-fields { display:flex; flex-wrap:wrap; gap:8px 16px; margin-top:8px; } .embed-field { flex:1 1 100%; min-width:120px; white-space:pre-wrap; overflow-wrap:anywhere; font-size:14px; } .embed-field.inline { flex-basis:28%; } .embed-field-name { margin-bottom:2px; font-weight:600; } .embed-image { display:block; max-width:100%; max-height:300px; margin-top:12px; border-radius:4px; object-fit:contain; } .embed-thumbnail { width:80px; height:80px; flex:0 0 80px; margin-top:8px; border-radius:4px; object-fit:cover; } .embed-video { display:inline-block; margin-top:8px; } .embed-footer { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-top:8px; color:var(--dim); font-size:12px; }
  .sticker { width:fit-content; margin:6px 0 0; color:var(--dim); font-size:11px; } .sticker img { display:block; max-width:160px; max-height:160px; object-fit:contain; }
  .component-container { max-width:520px; margin-top:6px; padding:14px 16px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); } .component-text + .component-text { margin-top:8px; } .component-text { white-space:pre-wrap; overflow-wrap:anywhere; } .component-section { display:flex; align-items:center; gap:14px; } .component-section > :first-child { flex:1; } .component-thumb { width:72px; height:72px; border-radius:8px; object-fit:cover; } .component-separator { height:1px; margin:10px 0; background:var(--border); } .component-button { display:inline-block; margin:6px 6px 0 0; padding:6px 14px; border-radius:8px; color:var(--text); background:var(--surface-3); border:1px solid var(--border); font-size:14px; font-weight:500; } .component-button.disabled { opacity:.6; } .media-gallery { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:4px; margin-top:6px; max-width:520px; } .media-gallery img { width:100%; aspect-ratio:16/10; object-fit:cover; border-radius:4px; } .media-gallery a { display:block; } .media-gallery.single img { aspect-ratio:auto; max-height:380px; object-fit:contain; }
  .poll { max-width:520px; margin-top:6px; padding:12px 14px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); } .poll-answer { display:flex; justify-content:space-between; gap:12px; margin-top:8px; padding:8px 10px; border-radius:6px; background:var(--surface-3); color:var(--muted); } .poll-answer b { color:var(--text); }
  .reactions { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; } .reaction { display:inline-flex; align-items:center; gap:5px; padding:2px 7px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); font-size:13px; } .reaction b { font-weight:600; }
  .empty { padding:38px 18px; color:var(--muted); text-align:center; } footer { padding:16px 2px 0; color:var(--dim); font-size:12px; } footer b { color:var(--muted); }
  @media (max-width:640px) { .shell { width:calc(100% - 20px); padding-top:10px; } .header-main { padding:14px 14px 4px; } .fact { padding:9px 14px; } .participants,.reason { padding-left:14px; padding-right:14px; } .message { padding:2px 10px; } .message-row,.grouped,.system { gap:10px; } .avatar,.side-time,.system-icon { width:32px; flex-basis:32px; height:auto; } .avatar { height:32px; } .reply { margin-left:26px; } .embed { display:block; } .embed-field.inline { flex-basis:100%; } }
  @media print { :root { --bg:#fff; --surface:#fff; --surface-2:#fff; --surface-3:#fff; --text:#111; } .topbar { display:none; } .header,.transcript { border-color:#ddd; } footer { display:none; } }
`;

// Keeps the reader's light/dark choice and writes the times in the reader's own time zone (the text written by the server stays as the fallback).
const SCRIPT = `(function(){var root=document.documentElement;try{var saved=localStorage.getItem('petto-transcript-theme');if(saved)root.setAttribute('data-theme',saved);}catch(e){}
var button=document.getElementById('theme');if(button)button.addEventListener('click',function(){var dark=root.getAttribute('data-theme')?root.getAttribute('data-theme')==='dark':matchMedia('(prefers-color-scheme: dark)').matches;var next=dark?'light':'dark';root.setAttribute('data-theme',next);try{localStorage.setItem('petto-transcript-theme',next);}catch(e){}});
try{var lang=root.lang||undefined;var full=new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeStyle:'short'});var short=new Intl.DateTimeFormat(lang,{timeStyle:'short'});document.querySelectorAll('time[datetime]').forEach(function(el){var d=new Date(el.getAttribute('datetime'));if(isNaN(d))return;el.title=full.format(d);el.textContent=el.dataset.short?short.format(d):full.format(d);});}catch(e){}})();`;

/**
 * The page of a transcript, from messages already fetched (or made up, in a check). `info` holds what the ticket knows: its number,
 * category, opener, closer, who claimed it, when it opened and closed, the reason and a notice (for example, the channel was deleted).
 */
function renderTranscriptHtml({ messages = [], guild = null, channelName = null, lang = 'en', bot = null, info = {}, homeUrl = null } = {}) {
  lang = normalizeLanguage(lang) ?? 'en';
  const messageMap = new Map(messages.map((message) => [message.id, message]));
  const body = messages.map((message, index) => renderMessage(message, messages[index - 1] ?? null, messageMap, bot, lang)).join('\n');
  const label = (key) => escapeHtml(t(lang, key));
  const guildName = guild?.name ?? t(lang, 'tickets.html.discordServer');
  const title = t(lang, 'tickets.html.title', { number: info.number ?? '' });
  let guildIcon = '';
  let guildBanner = '';
  try { guildIcon = safeUrl(guild?.iconURL?.({ extension: 'png', size: 128 }) ?? ''); } catch { guildIcon = ''; }
  try { guildBanner = safeUrl(guild?.bannerURL?.({ extension: 'png', size: 1024 }) ?? ''); } catch { guildBanner = ''; }
  const banner = guildBanner || bot?.bannerUrl || '';
  const participants = participantsOf(messages, bot, lang);
  const attachmentCount = messages.reduce((total, msg) => total + (msg.attachments?.size ?? collectionValues(msg.attachments).length), 0);
  const home = safeUrl(homeUrl);
  const brandInner = `${bot?.avatarUrl ? `<img src="${bot.avatarUrl}" alt="">` : ''}<span>${escapeHtml(bot?.name ?? 'Petto')}</span>`;
  const closed = Boolean(info.closedAt);

  const facts = [
    ['tickets.html.openedBy', personChip(info.opener, lang)],
    info.category ? ['tickets.html.categoryLabel', escapeHtml(info.category)] : null,
    info.claimedBy ? ['tickets.html.claimedBy', personChip(info.claimedBy, lang)] : null,
    closed ? ['tickets.html.closedBy', info.closedBy ? personChip(info.closedBy, lang) : `<span class="person muted">${label('tickets.html.closedByUnknown')}</span>`] : null,
    info.openedAt ? ['tickets.html.openedAt', `<time datetime="${escapeHtml(isoDate(info.openedAt))}">${escapeHtml(formatDate(info.openedAt, lang))}</time>`] : null,
    closed ? ['tickets.html.closedAt', `<time datetime="${escapeHtml(isoDate(info.closedAt))}">${escapeHtml(formatDate(info.closedAt, lang))}</time>`] : null,
    info.openedAt && closed && durationText(info.openedAt, info.closedAt, lang) ? ['tickets.html.durationLabel', escapeHtml(durationText(info.openedAt, info.closedAt, lang))] : null,
    ['tickets.html.messagesLabel', `${messages.length}${attachmentCount ? ` · ${escapeHtml(tn(lang, 'tickets.html.attachmentCount', attachmentCount, { count: attachmentCount }))}` : ''}`],
    channelName ? ['tickets.html.channelLabel', `#${escapeHtml(channelName)}`] : null,
  ].filter(Boolean).map(([key, value]) => `<div class="fact"><dt>${label(key)}</dt><dd>${value}</dd></div>`).join('');

  const people = participants.map((person) => `<span class="participant">${person.avatar ? `<img src="${person.avatar}" alt="" loading="lazy">` : '<span class="person-dot" aria-hidden="true"></span>'}<span${person.color ? ` style="color:${person.color}"` : ''}>${escapeHtml(person.name)}</span><b>${person.count}</b></span>`).join('');

  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · ${escapeHtml(guildName)}</title>
${bot?.avatarUrl ? `<link rel="icon" href="${bot.avatarUrl}">` : ''}
<style>${STYLE}</style>
</head>
<body>
  <main class="shell">
    <header class="topbar">${home ? `<a class="brand" href="${home}" aria-label="${label('tickets.html.home')}">${brandInner}</a>` : `<span class="brand">${brandInner}</span>`}<div class="top-actions"><button type="button" id="theme">${label('tickets.html.theme')}</button><button type="button" onclick="window.print()">${label('tickets.html.print')}</button></div></header>
    <section class="header${banner ? ' has-banner' : ''}">
      ${banner ? `<div class="banner" style="background-image:url('${banner}')"></div>` : ''}
      <div class="header-main">${guildIcon ? `<img class="guild-icon" src="${guildIcon}" alt="">` : `<div class="guild-icon" aria-hidden="true">${escapeHtml(String(guildName).trim().charAt(0).toUpperCase())}</div>`}<div><div class="eyebrow">${escapeHtml(guildName)} · ${label('tickets.html.eyebrow')}</div><h1>${escapeHtml(title)}<span class="status${closed ? '' : ' open'}">${label(closed ? 'tickets.html.statusClosed' : 'tickets.html.statusOpen')}</span></h1></div></div>
      ${info.reason ? `<div class="reason">${escapeHtml(t(lang, 'tickets.html.reasonLine', { reason: info.reason }))}</div>` : ''}
      <dl class="facts">${facts}</dl>
      ${people ? `<div class="participants" aria-label="${label('tickets.html.participants')}">${people}</div>` : ''}
    </section>
    <section class="transcript" aria-label="${label('tickets.html.eyebrow')}">${info.notice ? `<div class="notice">${escapeHtml(info.notice)}</div>` : ''}<div class="messages">${body || `<div class="empty">${label('tickets.html.empty')}</div>`}</div></section>
    <footer>${escapeHtml(t(lang, 'tickets.html.footer', { petto: '\u0002' })).replace('\u0002', '<b>Petto</b>')}</footer>
  </main>
<script>${SCRIPT}</script>
</body>
</html>`;

  return { html, messageCount: messages.length };
}

/**
 * The HTML transcript of a ticket channel; Petto's own labels are written in `lang`, the messages stay as they were.
 * `options.info` adds what the ticket knows (see renderTranscriptHtml); `openerTag` still works as the opener's name.
 */
async function buildTranscript(channel, { ticketNumber, openerTag, lang = currentLanguage(), info = {}, homeUrl = null } = {}) {
  const guild = channel.guild ?? null;
  // Petto's own member, fresh: the server may have changed its name or picture from the dashboard since it was cached.
  await guild?.members?.fetchMe?.({ force: true }).catch(() => null);
  const messages = await fetchAllMessages(channel);
  return renderTranscriptHtml({
    messages,
    guild,
    channelName: channel.name ?? null,
    lang: lang ?? currentLanguage(),
    bot: resolveBotIdentity(guild, channel.client),
    info: { number: ticketNumber, opener: info.opener ?? (openerTag ? { name: openerTag } : null), ...info },
    homeUrl,
  });
}

module.exports = { buildTranscript, renderTranscriptHtml, resolveBotIdentity, authorLook, personOf };
