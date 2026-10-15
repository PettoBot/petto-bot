const { sendLog, getAvatar } = require('./engine');
const { t, tn, guildLanguage, currentLanguage } = require('../i18n');

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, Math.max(0, max - 1))}…` : str;
}

function attachmentFields(message, lang = currentLanguage()) {
  const fields = [];

  if (message.attachments?.size) {
    const images = [...message.attachments.values()].filter((a) => a.contentType?.startsWith('image/'));
    const files = [...message.attachments.values()].filter((a) => !a.contentType?.startsWith('image/'));
    if (images.length) fields.push({ name: t(lang, 'logs.message.images', { count: images.length }), value: images.map((a) => `[${a.name}](${a.url})`).join('\n').slice(0, 1024), inline: false });
    if (files.length) fields.push({ name: t(lang, 'logs.message.files', { count: files.length }), value: files.map((a) => `[${a.name}](${a.url})`).join('\n').slice(0, 1024), inline: false });
  }

  if (message.stickers?.size) {
    fields.push({ name: t(lang, 'logs.message.stickers'), value: [...message.stickers.values()].map((s) => s.name).join(', ').slice(0, 1024), inline: false });
  }

  if (message.embeds?.length) {
    const desc = message.embeds
      .map((e, i) => {
        const parts = [];
        if (e.title) parts.push(`**${e.title}**`);
        if (e.description) parts.push(truncate(e.description, 100));
        if (e.url) parts.push(e.url);
        return t(lang, 'logs.message.embedLine', { number: i + 1, preview: parts.join(' - ') || t(lang, 'logs.message.noPreview') });
      })
      .join('\n');
    fields.push({ name: t(lang, 'logs.message.embeds', { count: message.embeds.length }), value: desc.slice(0, 1024), inline: false });
  }

  return fields;
}

function firstImage(message) {
  const attachment = [...(message.attachments?.values?.() ?? [])]
    .find((a) => a.contentType?.startsWith('image/') || /\.(?:png|jpe?g|gif|webp)(?:\?|$)/i.test(a.url ?? ''));
  if (attachment?.url) return attachment.url;

  const embed = message.embeds?.find((item) => item.image?.url || item.thumbnail?.url);
  return embed?.image?.url ?? embed?.thumbnail?.url ?? null;
}

async function hydrateMessage(message) {
  if (!message?.partial || typeof message.fetch !== 'function') return message;
  return message.fetch().catch(() => message);
}

function authorLabel(message, lang = currentLanguage()) {
  if (message.author?.id) return `<@${message.author.id}>`;
  if (message.authorId) return `<@${message.authorId}>`;
  return t(lang, 'logs.message.unknownUser');
}

function mediaFingerprint(message) {
  const attachments = [...(message.attachments?.values?.() ?? [])].map((a) => [a.id, a.name, a.url]);
  const embeds = (message.embeds ?? []).map((embed) => ({
    title: embed.title,
    description: embed.description,
    url: embed.url,
    image: embed.image?.url,
    thumbnail: embed.thumbnail?.url,
  }));
  return JSON.stringify({ attachments, embeds, stickers: [...(message.stickers?.keys?.() ?? [])] });
}

function mediaDescription(message, lang = currentLanguage()) {
  const file = t(lang, 'logs.message.file');
  const attachments = [...(message.attachments?.values?.() ?? [])].map((a) => a.url ? `[${a.name || file}](${a.url})` : a.name || file);
  const embeds = (message.embeds ?? []).map((embed, index) => (embed.url ? t(lang, 'logs.message.embedLine', { number: index + 1, preview: embed.url }) : t(lang, 'logs.message.embedNumber', { number: index + 1 })));
  return [...attachments, ...embeds].join('\n').slice(0, 1024) || t(lang, 'logs.noneItalic');
}

async function handleMessageDelete(message, client) {
  message = await hydrateMessage(message);
  if (!message.guild) return;
  const isBot = message.author?.bot;
  if (isBot && !message.attachments?.size && !message.embeds?.length && !message.stickers?.size) return;
  const lang = await guildLanguage(message.guild.id);

  const fields = [];
  const content = truncate(message.content, 1024);
  if (content) fields.push({ name: t(lang, 'logs.message.content'), value: content, inline: false });

  fields.push(...attachmentFields(message, lang));

  const img = firstImage(message);
  const vars = { author: authorLabel(message, lang), channel: `<#${message.channel.id}>` };

  const embed = {
    author: { name: t(lang, isBot ? 'logs.message.botDeleted.title' : 'logs.message.deleted.title'), icon_url: getAvatar(message.author) ?? undefined },
    description: t(lang, isBot ? 'logs.message.botDeleted.description' : 'logs.message.deleted.description', vars),
    fields: fields.length ? fields : [{ name: t(lang, 'logs.message.content'), value: t(lang, 'logs.message.noContent'), inline: false }],
    footer: { text: message.author?.id ? t(lang, 'logs.message.footer.withUser', { id: message.id, user: message.author.id }) : t(lang, 'logs.message.footer', { id: message.id }) },
    timestamp: new Date().toISOString(),
  };
  if (img) embed.image = { url: img };

  await sendLog(client, message.guild.id, 'messages', embed, { ignoreIds: [message.author?.id, message.channel.id].filter(Boolean) });
}

async function handleMessageUpdate(oldMessage, newMessage, client) {
  oldMessage = await hydrateMessage(oldMessage);
  newMessage = await hydrateMessage(newMessage);
  if (!oldMessage.author || oldMessage.author.bot || !oldMessage.guild) return;
  const contentChanged = oldMessage.content !== newMessage.content;
  const mediaChanged = mediaFingerprint(oldMessage) !== mediaFingerprint(newMessage);
  if (!contentChanged && !mediaChanged) return;
  const lang = await guildLanguage(oldMessage.guild.id);

  const fields = [];
  if (contentChanged) {
    const empty = t(lang, 'logs.message.empty');
    fields.push(
      { name: t(lang, 'logs.field.before'), value: truncate(oldMessage.content, 512) || empty, inline: false },
      { name: t(lang, 'logs.field.after'), value: truncate(newMessage.content, 512) || empty, inline: false },
    );
  }

  if (mediaChanged) {
    fields.push(
      { name: t(lang, 'logs.message.mediaBefore'), value: mediaDescription(oldMessage, lang), inline: false },
      { name: t(lang, 'logs.message.mediaAfter'), value: mediaDescription(newMessage, lang), inline: false },
    );
  }

  await sendLog(
    client,
    oldMessage.guild.id,
    'messages',
    {
      author: { name: t(lang, 'logs.message.edited.title'), icon_url: getAvatar(oldMessage.author) ?? undefined },
      description: t(lang, 'logs.message.edited.description', { author: `<@${oldMessage.author.id}>`, channel: `<#${oldMessage.channel.id}>`, url: newMessage.url }),
      fields,
      footer: { text: t(lang, 'logs.footer.user', { id: oldMessage.author.id }) },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [oldMessage.author.id, oldMessage.channel.id].filter(Boolean) },
  );
}

async function handleMessageBulkDelete(messages, channel, client) {
  if (!channel.guild) return;
  const lang = await guildLanguage(channel.guild.id);

  const cached = [...messages.values()].filter((m) => m.author);
  const lines = cached.slice(0, 15).map((m) => {
    const tag = m.author.bot ? t(lang, 'logs.message.bulk.botTag', { name: m.author.username }) : `**${m.author.username}**`;
    // The counts are written as they are (no thousands separator), like they always were.
    const content = truncate(m.content, 60) || (m.attachments?.size ? tn(lang, 'logs.message.bulk.attachments', m.attachments.size, { count: m.attachments.size }) : m.embeds?.length ? t(lang, 'logs.message.bulk.embed') : t(lang, 'logs.message.empty'));
    return `${tag}: ${content}`;
  });

  await sendLog(client, channel.guild.id, 'messages', {
    author: { name: t(lang, 'logs.message.bulk.title') },
    description: tn(lang, 'logs.message.bulk.description', messages.size, { count: messages.size, channel: `<#${channel.id}>` }),
    fields: [{ name: t(lang, 'logs.message.bulk.cached'), value: lines.join('\n').slice(0, 1024) || t(lang, 'logs.noneItalic'), inline: false }],
    footer: { text: tn(lang, 'logs.message.bulk.recovered', cached.length, { count: cached.length }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [channel.id] });
}

module.exports = { handleMessageDelete, handleMessageUpdate, handleMessageBulkDelete };
