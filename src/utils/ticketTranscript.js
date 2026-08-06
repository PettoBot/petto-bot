const MAX_MESSAGES = 2000;
const PLACEHOLDER = '\u0000';

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

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)} UTC`;
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

function renderAttachment(attachment) {
  const type = String(attachment.contentType ?? '').toLowerCase();
  const name = escapeHtml(attachment.name || 'Attachment');
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

function renderMentionToken(full, emojiName, emojiId, userId, roleId, channelId, broadcast, guild) {
  if (emojiId) {
    const extension = full.startsWith('<a:') ? 'gif' : 'png';
    const url = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}`;
    return `<img class="emoji" src="${url}" alt=":${escapeHtml(emojiName)}:" title=":${escapeHtml(emojiName)}:" loading="lazy">`;
  }
  if (userId) {
    const member = guild?.members?.cache?.get(userId);
    const user = guild?.client?.users?.cache?.get(userId);
    const name = member?.displayName ?? user?.globalName ?? user?.username ?? userId;
    return `<span class="mention">@${escapeHtml(name)}</span>`;
  }
  if (roleId) return `<span class="mention">@${escapeHtml(guild?.roles?.cache?.get(roleId)?.name ?? 'role')}</span>`;
  if (channelId) return `<span class="mention">#${escapeHtml(guild?.channels?.cache?.get(channelId)?.name ?? 'channel')}</span>`;
  if (broadcast) return `<span class="mention mention-broadcast">@${broadcast}</span>`;
  return escapeHtml(full);
}

function renderMarkdown(escapedText) {
  const preserved = [];
  const hold = (html) => `${PLACEHOLDER}${preserved.push(html) - 1}${PLACEHOLDER}`;

  let html = escapedText
    .replace(/```(?:([\w+-]+)\n)?([\s\S]*?)```/g, (_, language, code) => hold(`<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${code}</code></pre>`))
    .replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`))
    .replace(/\|\|([^\n]+?)\|\|/g, '<span class="spoiler">$1</span>')
    .replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="md-h2">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="md-h1">$1</div>')
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

  return html.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_, index) => preserved[Number(index)] ?? '');
}

function renderRichText(raw, guild) {
  const placeholders = [];
  let result = '';
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match;

  while ((match = TOKEN_RE.exec(String(raw ?? '')))) {
    result += escapeHtml(String(raw).slice(lastIndex, match.index));
    placeholders.push(renderMentionToken(match[0], match[1], match[2], match[3], match[4], match[5], match[6], guild));
    result += `${PLACEHOLDER}${placeholders.length - 1}${PLACEHOLDER}`;
    lastIndex = TOKEN_RE.lastIndex;
  }
  result += escapeHtml(String(raw ?? '').slice(lastIndex));

  return renderMarkdown(result).replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_, index) => placeholders[Number(index)] ?? '');
}

function renderEmbed(embed, guild) {
  const color = colorHex(embed.color);
  const authorIcon = safeUrl(embed.author?.iconURL);
  const embedUrl = safeUrl(embed.url);
  const author = embed.author?.name
    ? `<div class="embed-author">${authorIcon ? `<img src="${authorIcon}" alt="" loading="lazy">` : ''}${escapeHtml(embed.author.name)}</div>`
    : '';
  const titleText = embed.title ? renderRichText(embed.title, guild) : '';
  const title = titleText ? `<div class="embed-title">${embedUrl ? `<a href="${embedUrl}" target="_blank" rel="noopener">${titleText}</a>` : titleText}</div>` : '';
  const description = embed.description ? `<div class="embed-description">${renderRichText(embed.description, guild)}</div>` : '';
  const fields = (embed.fields ?? []).map((field) => `<div class="embed-field${field.inline ? ' inline' : ''}"><div class="embed-field-name">${renderRichText(field.name, guild)}</div><div>${renderRichText(field.value, guild)}</div></div>`).join('');
  const thumbnail = safeUrl(embed.thumbnail?.url);
  const image = safeUrl(embed.image?.url);
  const footerIcon = safeUrl(embed.footer?.iconURL);
  const provider = embed.provider?.name ? `<span class="embed-provider">${escapeHtml(embed.provider.name)}</span>` : '';
  const timestamp = embed.timestamp ? `<span class="embed-timestamp">${escapeHtml(formatDate(embed.timestamp))}</span>` : '';
  const video = safeUrl(embed.video?.url);

  return `<article class="embed" style="--embed-color:${color}">
    <div class="embed-main">
      ${author}${title}${provider}${description}${fields ? `<div class="embed-fields">${fields}</div>` : ''}
      ${image ? `<img class="embed-image" src="${image}" alt="" loading="lazy">` : ''}
      ${video ? `<a class="embed-video" href="${video}" target="_blank" rel="noopener">Open embedded video</a>` : ''}
      ${embed.footer?.text || timestamp ? `<div class="embed-footer">${footerIcon ? `<img src="${footerIcon}" alt="" loading="lazy">` : ''}${embed.footer?.text ? escapeHtml(embed.footer.text) : ''}${timestamp}</div>` : ''}
    </div>
    ${thumbnail ? `<img class="embed-thumbnail" src="${thumbnail}" alt="" loading="lazy">` : ''}
  </article>`;
}

function renderSticker(sticker) {
  const url = safeUrl(sticker.url || `https://cdn.discordapp.com/stickers/${sticker.id}.png`);
  const name = escapeHtml(sticker.name || 'Sticker');
  if (!url) return '';
  const format = String(sticker.format ?? '').toLowerCase();
  if (format.includes('lottie') || url.endsWith('.json')) return `<div class="sticker sticker-link"><a href="${url}" target="_blank" rel="noopener">Open sticker: ${name}</a></div>`;
  return `<figure class="sticker"><img src="${url}" alt="${name}" loading="lazy"><figcaption>${name}</figcaption></figure>`;
}

function renderComponent(component, guild) {
  const c = typeof component?.toJSON === 'function' ? component.toJSON() : component;
  if (!c) return '';
  if (c.type === 10 && c.content) return `<div class="component-text">${renderRichText(c.content, guild)}</div>`;
  if (c.type === 9) return `<div class="component-section">${(c.components ?? []).map((child) => renderComponent(child, guild)).join('')}${c.accessory ? `<div class="component-accessory">${renderComponent(c.accessory, guild)}</div>` : ''}</div>`;
  if (c.type === 17) return `<div class="component-container">${(c.components ?? []).map((child) => renderComponent(child, guild)).join('')}</div>`;
  if (c.type === 12) return `<div class="media-gallery">${(c.items ?? []).map((item) => { const url = safeUrl(item.media?.url || item.url); return url ? `<img src="${url}" alt="${escapeHtml(item.description || '')}" loading="lazy">` : ''; }).join('')}</div>`;
  if (c.type === 13) { const url = safeUrl(c.file?.url || c.url); return url ? `<div class="attachment"><span class="file-icon" aria-hidden="true">↗</span><a href="${url}" target="_blank" rel="noopener">${escapeHtml(c.name || 'File')}</a></div>` : ''; }
  if (c.type === 14) return '<div class="component-separator" aria-hidden="true"></div>';
  if (c.type === 2) return c.url ? `<a class="component-button" href="${safeUrl(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.label || 'Open link')}</a>` : `<span class="component-button disabled">${escapeHtml(c.label || 'Button')}</span>`;
  if (Array.isArray(c.components)) return c.components.map((child) => renderComponent(child, guild)).join('');
  return '';
}

function renderComponents(components, guild) {
  return collectionValues(components).map((component) => renderComponent(component, guild)).join('');
}

function avatarUrl(user, size = 64) {
  if (!user?.displayAvatarURL) return '';
  const animated = user.avatar?.startsWith('a_');
  return safeUrl(user.displayAvatarURL({ extension: animated ? 'gif' : 'png', size }));
}

function renderReaction(reaction) {
  const emoji = reaction.emoji;
  const id = emoji?.id;
  const emojiHtml = id
    ? `<img class="reaction-emoji" src="https://cdn.discordapp.com/emojis/${id}.${emoji.animated ? 'gif' : 'png'}" alt="${escapeHtml(emoji.name || 'emoji')}" loading="lazy">`
    : escapeHtml(emoji?.name || '•');
  return `<span class="reaction">${emojiHtml}<b>${Number(reaction.count ?? 0)}</b></span>`;
}

function renderReply(msg, messageMap) {
  const reference = msg.reference?.messageId ? messageMap.get(msg.reference.messageId) : null;
  if (!reference) return '';
  const author = reference.member?.displayName ?? reference.author?.globalName ?? reference.author?.username ?? 'Unknown user';
  const snippet = reference.content || (reference.embeds?.length ? '[embed]' : reference.attachments?.size ? '[attachment]' : '[message]');
  return `<div class="reply"><span>Replying to <b>${escapeHtml(author)}</b></span><span>${escapeHtml(String(snippet).slice(0, 180))}</span></div>`;
}

function renderPoll(poll, guild) {
  if (!poll) return '';
  const question = poll.question?.text ?? poll.question ?? 'Poll';
  const answers = collectionValues(poll.answers ?? poll.answerOptions);
  if (!answers.length) return `<div class="poll"><strong>${renderRichText(question, guild)}</strong></div>`;
  return `<div class="poll"><strong>${renderRichText(question, guild)}</strong>${answers.map((answer) => `<div class="poll-answer"><span>${renderRichText(answer.pollMedia?.text ?? answer.text ?? 'Option', guild)}</span>${answer.voteCount != null ? `<b>${answer.voteCount}</b>` : ''}</div>`).join('')}</div>`;
}

function renderMessage(msg, messageMap) {
  const avatar = avatarUrl(msg.author);
  const displayName = msg.member?.displayName ?? msg.author?.globalName ?? msg.author?.username ?? 'Unknown user';
  const rawText = msg.content || '';
  const content = rawText ? `<div class="content">${renderRichText(rawText, msg.guild)}</div>` : '';
  const components = renderComponents(msg.components, msg.guild);
  const attachments = collectionValues(msg.attachments).map(renderAttachment).join('');
  const embeds = (msg.embeds ?? []).map((embed) => renderEmbed(embed, msg.guild)).join('');
  const stickers = collectionValues(msg.stickers).map(renderSticker).join('');
  const reactions = collectionValues(msg.reactions?.cache).map(renderReaction).join('');
  const poll = renderPoll(msg.poll, msg.guild);
  const hasRichContent = content || components || attachments || embeds || stickers || poll;
  const botTag = msg.author?.bot ? '<span class="bot-tag">APP</span>' : '';
  const edited = msg.editedTimestamp ? '<span class="edited">edited</span>' : '';
  const reply = renderReply(msg, messageMap);
  const time = formatDate(msg.createdTimestamp);
  const messageId = escapeHtml(msg.id || 'message');

  return `<article class="message" id="message-${messageId}">
    ${avatar ? `<img class="avatar" src="${avatar}" alt="" loading="lazy">` : '<div class="avatar avatar-fallback" aria-hidden="true"></div>'}
    <div class="message-body">
      <div class="meta"><span class="author">${escapeHtml(displayName)}</span>${botTag}<time datetime="${escapeHtml(new Date(msg.createdTimestamp).toISOString())}" title="${escapeHtml(time)}">${escapeHtml(time)}</time>${edited}</div>
      ${reply}${content}${components}${attachments}${embeds}${stickers}${poll}${reactions ? `<div class="reactions">${reactions}</div>` : ''}
      ${hasRichContent ? '' : '<div class="empty-content">No text content</div>'}
    </div>
  </article>`;
}

async function buildTranscript(channel, { ticketNumber, openerTag } = {}) {
  const messages = await fetchAllMessages(channel);
  const messageMap = new Map(messages.map((message) => [message.id, message]));
  const body = messages.map((message) => renderMessage(message, messageMap)).join('\n');
  const guildName = channel.guild?.name ?? 'Discord server';
  const title = `Ticket #${ticketNumber ?? ''}`;
  const subtitle = `${channel.name ? `#${channel.name}` : 'Ticket'} · ${messages.length} message${messages.length === 1 ? '' : 's'}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(title)} · Petto</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<style>
  :root { color-scheme: dark; --bg:#111214; --surface:#15171b; --surface-2:#191b20; --border:#2a2d35; --border-soft:#202228; --text:#f3f1ea; --muted:#9c968a; --dim:#6f6a62; --accent:#8399ff; --accent-soft:rgba(131,153,255,.14); --green:#a5ea7a; --font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; --mono:ui-monospace,"SFMono-Regular",Consolas,monospace; }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font:15px/1.55 var(--font); -webkit-font-smoothing:antialiased; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  .shell { width:min(1120px,calc(100% - 32px)); margin:0 auto; padding:18px 0 56px; }
  .topbar { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:10px 12px; border:1px solid var(--border); border-radius:18px; background:rgba(17,18,20,.9); position:sticky; top:14px; z-index:4; box-shadow:0 18px 50px -34px rgba(0,0,0,.8); backdrop-filter:blur(14px); }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:17px; } .brand img { width:30px; height:30px; object-fit:contain; }
  .top-actions { display:flex; align-items:center; gap:8px; } .top-actions button { border:1px solid var(--border); border-radius:10px; background:var(--surface); color:var(--text); padding:9px 12px; cursor:pointer; font:600 13px var(--font); } .top-actions button:hover { background:var(--surface-2); border-color:#414654; }
  .hero { margin:54px 0 24px; display:flex; align-items:flex-end; justify-content:space-between; gap:24px; } .eyebrow { color:var(--dim); font:500 11px var(--mono); letter-spacing:.12em; text-transform:uppercase; } h1 { margin:8px 0 5px; font-size:clamp(28px,4vw,42px); line-height:1.08; letter-spacing:-.035em; } .sub { color:var(--muted); margin:0; } .hero-meta { color:var(--muted); text-align:right; font-size:13px; } .hero-meta strong { color:var(--text); display:block; font-size:15px; }
  .transcript { border:1px solid var(--border); border-radius:18px; background:var(--surface); overflow:hidden; }
  .transcript-head { display:flex; flex-wrap:wrap; gap:10px 18px; padding:18px 22px; border-bottom:1px solid var(--border-soft); background:var(--surface-2); color:var(--muted); font-size:13px; } .chip { display:inline-flex; align-items:center; gap:6px; } .chip strong { color:var(--text); font-weight:600; }
  .messages { padding:10px 22px 24px; }
  .message { display:flex; gap:12px; padding:16px 0; border-bottom:1px solid var(--border-soft); scroll-margin-top:90px; } .message:last-child { border-bottom:0; } .avatar { width:40px; height:40px; flex:0 0 40px; border-radius:50%; object-fit:cover; background:var(--surface-2); } .avatar-fallback { border:1px solid var(--border); }
  .message-body { min-width:0; flex:1; } .meta { display:flex; align-items:baseline; flex-wrap:wrap; gap:7px; } .author { color:var(--text); font-weight:700; } time,.edited { color:var(--dim); font-size:11px; } .edited { font-style:italic; } .bot-tag { padding:2px 5px; border-radius:4px; color:#20242b; background:var(--accent); font-size:9px; font-weight:800; letter-spacing:.04em; }
  .content { margin-top:3px; white-space:pre-wrap; overflow-wrap:anywhere; } .empty-content { margin-top:4px; color:var(--dim); font-style:italic; } .emoji,.reaction-emoji { width:1.4em; height:1.4em; display:inline-block; vertical-align:-.32em; object-fit:contain; } .mention { padding:1px 4px; border-radius:4px; color:#c9d0ff; background:var(--accent-soft); font-weight:600; } .mention-broadcast { color:#ffd86b; }
  code { padding:2px 5px; border-radius:5px; background:#0e0f11; color:#d9defc; font:0.88em var(--mono); } pre { margin:8px 0; padding:12px 14px; max-width:100%; overflow:auto; border:1px solid var(--border); border-radius:10px; background:#0e0f11; color:#d8dbe5; white-space:pre; } pre code { padding:0; background:none; } blockquote { margin:7px 0; padding:2px 12px; border-left:3px solid var(--accent); color:var(--muted); } .md-h1,.md-h2,.md-h3 { margin:9px 0 4px; font-weight:700; color:var(--text); } .md-h1 { font-size:1.35em; } .md-h2 { font-size:1.2em; } .md-h3 { font-size:1.08em; } .md-list-item { padding-left:16px; position:relative; } .md-list-item::before { content:"•"; position:absolute; left:2px; color:var(--accent); } .spoiler { padding:0 4px; border-radius:4px; background:#2a2d35; color:transparent; cursor:pointer; transition:color .15s ease; } .spoiler:hover,.spoiler:focus { color:inherit; }
  .reply { display:flex; flex-wrap:wrap; gap:4px 8px; margin:7px 0 4px; padding-left:10px; border-left:2px solid var(--border); color:var(--dim); font-size:12px; } .reply span:last-child { flex-basis:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .attachment,.audio-attachment { display:flex; align-items:center; gap:8px; width:fit-content; max-width:100%; margin-top:9px; padding:9px 11px; border:1px solid var(--border); border-radius:10px; background:var(--surface-2); overflow-wrap:anywhere; } .file-icon { display:grid; place-items:center; width:25px; height:25px; border-radius:7px; color:var(--accent); background:var(--accent-soft); } audio { max-width:min(420px,100%); } .media { width:fit-content; max-width:100%; margin:9px 0 0; } .media img,.media video { display:block; max-width:min(560px,100%); max-height:420px; border:1px solid var(--border); border-radius:11px; object-fit:contain; background:#0e0f11; } .media figcaption,.sticker figcaption,.media-link { display:block; margin-top:5px; color:var(--dim); font-size:11px; }
  .embed { display:flex; gap:14px; max-width:620px; margin-top:10px; padding:12px 14px; border:1px solid var(--border); border-left:4px solid var(--embed-color); border-radius:10px; background:var(--surface-2); } .embed-main { min-width:0; flex:1; } .embed-author { display:flex; align-items:center; gap:7px; margin-bottom:5px; font-size:12px; font-weight:700; } .embed-author img,.embed-footer img { width:20px; height:20px; border-radius:50%; object-fit:cover; } .embed-title { margin-bottom:4px; font-size:16px; font-weight:700; } .embed-title a { color:var(--text); } .embed-provider,.embed-timestamp { color:var(--dim); font-size:11px; } .embed-description { margin-top:5px; white-space:pre-wrap; overflow-wrap:anywhere; } .embed-fields { display:flex; flex-wrap:wrap; gap:12px 16px; margin-top:12px; } .embed-field { flex:1 1 100%; min-width:140px; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; } .embed-field.inline { flex-basis:28%; } .embed-field-name { margin-bottom:2px; color:var(--muted); font-weight:700; } .embed-image { display:block; width:auto; max-width:100%; max-height:360px; margin-top:12px; border-radius:8px; object-fit:contain; } .embed-thumbnail { width:80px; height:80px; flex:0 0 80px; border-radius:8px; object-fit:cover; } .embed-video { display:inline-block; margin-top:9px; } .embed-footer { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-top:11px; color:var(--muted); font-size:11px; } .embed-timestamp { margin-left:auto; }
  .sticker { width:fit-content; margin:9px 0 0; color:var(--dim); font-size:11px; } .sticker img { display:block; width:auto; max-width:180px; max-height:180px; object-fit:contain; }
  .component-container { max-width:620px; margin-top:10px; padding:12px; border:1px solid var(--border); border-radius:12px; background:var(--surface-2); } .component-text + .component-text { margin-top:7px; } .component-section { display:flex; align-items:center; gap:14px; padding:8px 0; } .component-section > :first-child { flex:1; } .component-accessory { flex:0 0 auto; } .component-separator { height:1px; margin:9px 0; background:var(--border); } .component-button { display:inline-block; margin:3px 4px 0 0; padding:6px 10px; border-radius:7px; color:var(--text); background:var(--accent-soft); font-size:12px; font-weight:600; } .component-button.disabled { opacity:.55; } .media-gallery { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px; margin-top:9px; } .media-gallery img { width:100%; aspect-ratio:16/10; object-fit:cover; border-radius:8px; }
  .poll { max-width:620px; margin-top:10px; padding:12px 14px; border:1px solid var(--border); border-radius:10px; background:var(--surface-2); } .poll-answer { display:flex; justify-content:space-between; gap:12px; margin-top:8px; padding:7px 9px; border-radius:7px; background:var(--bg); color:var(--muted); } .poll-answer b { color:var(--text); }
  .reactions { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; } .reaction { display:inline-flex; align-items:center; gap:5px; padding:4px 8px; border:1px solid var(--border); border-radius:8px; color:var(--muted); background:var(--surface-2); font-size:12px; } .reaction b { color:var(--text); font-weight:600; }
  .empty { padding:38px 18px; color:var(--muted); text-align:center; } footer { padding:18px 2px 0; color:var(--dim); font-size:12px; } footer b { color:var(--text); }
  @media (max-width:680px) { .shell { width:min(100% - 18px,1120px); padding-top:9px; } .topbar { top:8px; } .top-actions button { padding:8px 9px; } .hero { display:block; margin:34px 0 18px; } .hero-meta { margin-top:12px; text-align:left; } .messages { padding:6px 13px 18px; } .message { gap:9px; padding:13px 0; } .avatar { width:32px; height:32px; flex-basis:32px; } .embed { display:block; } .embed-thumbnail { width:64px; height:64px; margin-top:10px; } .embed-field.inline { flex-basis:100%; } .transcript-head { padding:14px; } }
  @media print { body { background:#fff; color:#111; } .shell { width:100%; padding:0; } .topbar,.top-actions { display:none; } .hero { margin:0 0 16px; } .transcript { border:0; } .transcript-head,.message,.embed,.attachment,.poll,.component-container { background:#fff; border-color:#ddd; } a { color:#111; text-decoration:underline; } footer { display:none; } }
</style>
</head>
<body>
  <main class="shell">
    <header class="topbar"><a class="brand" href="/" aria-label="Petto home"><img src="/assets/favicon.png" alt=""> <span>Petto</span></a><div class="top-actions"><button type="button" onclick="window.print()">Print</button></div></header>
    <section class="hero"><div><div class="eyebrow">Ticket transcript</div><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(guildName)} · ${escapeHtml(subtitle)}</p></div><div class="hero-meta"><strong>${escapeHtml(openerTag ?? 'Unknown user')}</strong>Opened by</div></section>
    <section class="transcript" aria-label="Ticket transcript"><div class="transcript-head"><span class="chip"><strong>Channel</strong> #${escapeHtml(channel.name ?? 'ticket')}</span><span class="chip"><strong>Messages</strong> ${messages.length}</span><span class="chip"><strong>Rendered</strong> text, embeds, media and stickers</span></div><div class="messages">${body || '<div class="empty">No messages were found in this ticket.</div>'}</div></section>
    <footer>Transcript generated by <b>Petto</b> · Discord content is shown as it was available when the transcript was created.</footer>
  </main>
</body>
</html>`;

  return { html, messageCount: messages.length };
}

module.exports = { buildTranscript };
