const MAX_MESSAGES = 2000; // safety cap so a runaway ticket can't hang the close flow

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeUrl(raw) {
  try {
    const url = new URL(String(raw ?? ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return escapeHtml(url.toString());
  } catch {
    return '';
  }
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

  return messages.reverse(); // oldest first
}

function renderAttachment(a) {
  const type = a.contentType ?? '';
  const url = safeUrl(a.url);
  if (!url) return `<div class="attachment">${escapeHtml(a.name)}</div>`;
  if (type.startsWith('image/')) return `<div class="media"><img src="${url}" alt="${escapeHtml(a.name)}" loading="lazy"></div>`;
  if (type.startsWith('video/')) return `<div class="media"><video src="${url}" controls preload="metadata"></video></div>`;
  return `<div class="attachment"><a href="${url}" target="_blank" rel="noopener">${escapeHtml(a.name)}</a></div>`;
}

const TOKEN_RE = /<a?:(\w+):(\d+)>|<@!?(\d+)>|<@&(\d+)>|<#(\d+)>/g;

/**
 * Resolves Discord's raw `<...>` mention/emoji syntax into real HTML, escaping everything else in
 * between. Looks members/roles/channels up via the guild's cache instead of `msg.mentions` — that
 * collection is built by discord.js parsing `.content`, which is empty for Components V2 messages,
 * so it wouldn't resolve anything for most of what Petto itself sends.
 */
function renderMentionsAndEmoji(raw, guild) {
  let result = '';
  let lastIndex = 0;
  let match;
  TOKEN_RE.lastIndex = 0;

  while ((match = TOKEN_RE.exec(raw))) {
    result += escapeHtml(raw.slice(lastIndex, match.index));
    const [full, emojiName, emojiId, userId, roleId, channelId] = match;

    if (emojiId) {
      const ext = full.startsWith('<a:') ? 'gif' : 'png';
      result += `<img class="emoji" src="https://cdn.discordapp.com/emojis/${emojiId}.${ext}" alt=":${escapeHtml(emojiName)}:" title=":${escapeHtml(emojiName)}:">`;
    } else if (userId) {
      const name = guild?.members.cache.get(userId)?.displayName ?? guild?.client.users.cache.get(userId)?.username ?? userId;
      result += `<span class="mention">@${escapeHtml(name)}</span>`;
    } else if (roleId) {
      result += `<span class="mention">@${escapeHtml(guild?.roles.cache.get(roleId)?.name ?? 'role')}</span>`;
    } else if (channelId) {
      result += `<span class="mention">#${escapeHtml(guild?.channels.cache.get(channelId)?.name ?? 'channel')}</span>`;
    }

    lastIndex = TOKEN_RE.lastIndex;
  }

  result += escapeHtml(raw.slice(lastIndex));
  return result;
}

/** A small subset of Discord's markdown, applied after renderMentionsAndEmoji so it only ever touches escaped/safe text. */
function renderMarkdown(html) {
  return html
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="md-h2">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="md-h1">$1</div>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/(?<![*\w])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '<i>$1</i>')
    .replace(/(?<![_\w])_(?!_)([^_\n]+?)_(?!_)/g, '<i>$1</i>');
}

function renderEmbedText(raw, guild) {
  return renderMarkdown(renderMentionsAndEmoji(raw, guild));
}

function renderEmbed(e, guild) {
  const color = e.color != null ? `#${e.color.toString(16).padStart(6, '0')}` : '#5865f2';
  const authorIcon = safeUrl(e.author?.iconURL);
  const embedUrl = safeUrl(e.url);
  const author = e.author?.name ? `<div class="embed-author">${authorIcon ? `<img src="${authorIcon}" alt="">` : ''}${escapeHtml(e.author.name)}</div>` : '';
  const titleText = e.title ? renderEmbedText(e.title, guild) : '';
  const title = titleText ? `<div class="embed-title">${embedUrl ? `<a href="${embedUrl}" target="_blank" rel="noopener">${titleText}</a>` : titleText}</div>` : '';
  const desc = e.description ? `<div class="embed-desc">${renderEmbedText(e.description, guild)}</div>` : '';
  const fields = (e.fields ?? [])
    .map((f) => `<div class="embed-field ${f.inline ? 'inline' : ''}"><div class="embed-field-name">${escapeHtml(f.name)}</div><div>${renderEmbedText(f.value, guild)}</div></div>`)
    .join('');
  const thumbUrl = safeUrl(e.thumbnail?.url);
  const imageUrl = safeUrl(e.image?.url);
  const footerIcon = safeUrl(e.footer?.iconURL);
  const thumb = thumbUrl ? `<img class="embed-thumb" src="${thumbUrl}" alt="" loading="lazy">` : '';
  const image = imageUrl ? `<img class="embed-image" src="${imageUrl}" alt="" loading="lazy">` : '';
  const footer = e.footer?.text ? `<div class="embed-footer">${footerIcon ? `<img src="${footerIcon}" alt="">` : ''}${escapeHtml(e.footer.text)}</div>` : '';

  return `<div class="embed" style="border-left-color:${color}">
    ${thumb}
    <div class="embed-body">${author}${title}${desc}${fields ? `<div class="embed-fields">${fields}</div>` : ''}${image}${footer}</div>
  </div>`;
}

function renderSticker(sticker) {
  const url = safeUrl(sticker.url || `https://cdn.discordapp.com/stickers/${sticker.id}.png`);
  const name = escapeHtml(sticker.name || 'Sticker');
  if (!url) return '';
  const format = String(sticker.format ?? '').toLowerCase();
  if (format.includes('lottie') || url.endsWith('.json')) {
    return `<div class="sticker-link"><a href="${url}" target="_blank" rel="noopener">Sticker: ${name}</a></div>`;
  }
  return `<div class="sticker"><img src="${url}" alt="${name}" loading="lazy"><span>${name}</span></div>`;
}

// Petto sends most of its own messages as Components V2 (ContainerBuilder/TextDisplayBuilder)
// instead of plain `content` — those messages have empty `.content` and `.embeds`, so without this
// the transcript would render them as blank. Recurses through Container/Section wrappers to pull
// out every TextDisplay's text; ActionRows/buttons/selects have no text and just yield nothing.
function extractV2Text(components) {
  const parts = [];
  for (const raw of components ?? []) {
    const c = typeof raw?.toJSON === 'function' ? raw.toJSON() : raw;
    if (!c) continue;
    if (c.type === 10 && c.content) parts.push(c.content);
    if (Array.isArray(c.components)) parts.push(...extractV2Text(c.components));
  }
  return parts;
}

/** Avatar URL that keeps animated (GIF) avatars animated instead of forcing a static frame. */
function avatarUrl(user, size = 64) {
  const animated = user.avatar?.startsWith('a_');
  return safeUrl(user.displayAvatarURL({ extension: animated ? 'gif' : 'png', size }));
}

function renderMessage(msg) {
  const avatar = avatarUrl(msg.author);
  const displayName = msg.member?.displayName ?? msg.author.globalName ?? msg.author.username;
  const time = new Date(msg.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
  const rawText = msg.content || extractV2Text(msg.components).join('\n\n');
  const content = renderMarkdown(renderMentionsAndEmoji(rawText, msg.guild));
  const attachments = [...msg.attachments.values()].map(renderAttachment).join('');
  const embeds = msg.embeds.map((e) => renderEmbed(e, msg.guild)).join('');
  const stickers = msg.stickers ? [...msg.stickers.values()].map(renderSticker).join('') : '';

  return `<div class="message">
    ${avatar ? `<img class="avatar" src="${avatar}" alt="" loading="lazy">` : '<div class="avatar avatar-fallback" aria-hidden="true"></div>'}
    <div class="body">
      <div class="meta"><span class="author">${escapeHtml(displayName)}</span><span class="time">${time} UTC</span></div>
      <div class="content">${content || (attachments || embeds || stickers ? '' : '<i>(no text content)</i>')}</div>
      ${attachments}${embeds}${stickers}
    </div>
  </div>`;
}

/** Fetches a ticket channel's full history and renders it as a self-contained dark-themed HTML page. */
async function buildTranscript(channel, { ticketNumber, openerTag } = {}) {
  const messages = await fetchAllMessages(channel);
  const body = messages.map(renderMessage).join('\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transcript - Ticket #${ticketNumber ?? ''}</title>
<style>
  body { background:#1e1d1b; color:#e8e6e3; font-family: -apple-system, "Segoe UI", "Segoe UI Emoji", "Noto Color Emoji", Roboto, sans-serif; margin:0; padding:24px; }
  a { color:#83a7ff; text-decoration:none; }
  a:hover { text-decoration:underline; }
  h1 { font-size:18px; color:#f5f5f4; margin:0 0 4px; }
  .sub { color:#9c9891; font-size:13px; margin-bottom:24px; }
  .message { display:flex; gap:12px; padding:10px 0; border-bottom:1px solid #2c2a27; }
  .avatar { width:40px; height:40px; border-radius:50%; flex-shrink:0; }
  .avatar-fallback { background:#4b4033; }
  .meta { display:flex; gap:8px; align-items:baseline; }
  .author { font-weight:600; color:#7797f0; }
  .time { font-size:11px; color:#7a766f; }
  .content { margin-top:2px; white-space:pre-wrap; word-break:break-word; }
  .emoji { width:1.375em; height:1.375em; vertical-align:-0.3em; }
  .mention { color:#c9cdfb; background:rgba(88,101,242,0.3); border-radius:3px; padding:0 2px; font-weight:500; }
  code { background:#2c2a27; padding:1px 4px; border-radius:3px; font-family:"SF Mono", Consolas, monospace; font-size:0.9em; }
  pre { background:#2c2a27; padding:8px 10px; border-radius:6px; overflow-x:auto; white-space:pre; margin:4px 0; }
  pre code { background:none; padding:0; }
  .md-h1, .md-h2, .md-h3 { margin:6px 0 4px; color:#f5f5f4; font-weight:700; }
  .md-h1 { font-size:1.4em; }
  .md-h2 { font-size:1.25em; }
  .md-h3 { font-size:1.1em; }
  blockquote { border-left:3px solid #4a4741; margin:4px 0; padding:2px 10px; color:#c9c6c0; }
  .attachment, .sticker-link { font-size:12px; color:#9c9891; margin-top:6px; }
  .attachment a { color:#7797f0; }
  .media { margin-top:6px; }
  .media img, .media video { max-width:400px; max-height:300px; border-radius:8px; display:block; }
  .embed { display:flex; gap:12px; margin-top:6px; padding:10px 12px; background:#26241f; border-left:4px solid #5865f2; border-radius:4px; max-width:480px; }
  .embed-body { min-width:0; flex:1; }
  .embed-author { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:600; margin-bottom:4px; }
  .embed-author img { width:20px; height:20px; border-radius:50%; }
  .embed-title { font-weight:700; color:#f5f5f4; margin-bottom:4px; }
  .embed-title a { color:inherit; }
  .embed-desc { font-size:13px; white-space:pre-wrap; word-break:break-word; }
  .embed-fields { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .embed-field { font-size:13px; white-space:pre-wrap; word-break:break-word; }
  .embed-field.inline { flex:1 1 30%; min-width:120px; }
  .embed-field-name { font-weight:600; margin-bottom:2px; }
  .embed-image { max-width:100%; max-height:280px; border-radius:4px; margin-top:8px; }
  .embed-thumb { width:64px; height:64px; border-radius:4px; object-fit:cover; flex-shrink:0; }
  .embed-footer { display:flex; align-items:center; gap:6px; font-size:11px; color:#9c9891; margin-top:8px; }
  .embed-footer img { width:16px; height:16px; border-radius:50%; }
  .sticker { display:flex; flex-direction:column; align-items:flex-start; gap:3px; margin-top:8px; color:#9c9891; font-size:11px; }
  .sticker img { max-width:180px; max-height:180px; object-fit:contain; }
  @media (max-width: 640px) { body { padding:14px; } .embed { max-width:none; } .media img, .media video { max-width:100%; } }
</style>
</head>
<body>
  <h1>Ticket #${ticketNumber ?? ''} transcript</h1>
  <div class="sub">Channel: #${escapeHtml(channel.name)} &middot; Opened by ${escapeHtml(openerTag ?? 'unknown')} &middot; ${messages.length} message(s)</div>
  ${body || '<p>No messages.</p>'}
</body>
</html>`;

  return { html, messageCount: messages.length };
}

module.exports = { buildTranscript };
