const { sendLog, getAvatar } = require('./engine');

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function attachmentFields(message) {
  const fields = [];

  if (message.attachments?.size) {
    const images = [...message.attachments.values()].filter((a) => a.contentType?.startsWith('image/'));
    const files = [...message.attachments.values()].filter((a) => !a.contentType?.startsWith('image/'));
    if (images.length) fields.push({ name: `Images (${images.length})`, value: images.map((a) => `[${a.name}](${a.url})`).join('\n').slice(0, 1024), inline: false });
    if (files.length) fields.push({ name: `Files (${files.length})`, value: files.map((a) => `[${a.name}](${a.url})`).join('\n').slice(0, 1024), inline: false });
  }

  if (message.stickers?.size) {
    fields.push({ name: 'Stickers', value: [...message.stickers.values()].map((s) => s.name).join(', ').slice(0, 1024), inline: false });
  }

  if (message.embeds?.length) {
    const desc = message.embeds
      .map((e, i) => {
        const parts = [];
        if (e.title) parts.push(`**${e.title}**`);
        if (e.description) parts.push(truncate(e.description, 100));
        if (e.url) parts.push(e.url);
        return `Embed ${i + 1}: ${parts.join(' - ') || '*[no preview]*'}`;
      })
      .join('\n');
    fields.push({ name: `Embeds (${message.embeds.length})`, value: desc.slice(0, 1024), inline: false });
  }

  return fields;
}

function firstImage(message) {
  if (!message.attachments?.size) return null;
  const img = [...message.attachments.values()].find((a) => a.contentType?.startsWith('image/'));
  return img?.url ?? null;
}

async function handleMessageDelete(message, client) {
  if (!message.guild) return;
  const isBot = message.author?.bot;
  if (isBot && !message.attachments?.size && !message.embeds?.length && !message.stickers?.size) return;

  const fields = [];
  const content = truncate(message.content, 1024);
  if (content) fields.push({ name: 'Content', value: content, inline: false });

  fields.push(...attachmentFields(message));

  const img = firstImage(message);

  const embed = {
    author: { name: isBot ? 'Bot Message Deleted' : 'Message Deleted', icon_url: getAvatar(message.author) ?? undefined },
    description: `Message by <@${message.author?.id}>${isBot ? ' (**bot**)' : ''} deleted in <#${message.channel.id}>`,
    fields: fields.length ? fields : [{ name: 'Content', value: '*[no content]*', inline: false }],
    footer: { text: `User ID: ${message.author?.id}` },
    timestamp: new Date().toISOString(),
  };
  if (img) embed.image = { url: img };

  await sendLog(client, message.guild.id, 'messages', embed, { ignoreIds: [message.author?.id] });
}

async function handleMessageUpdate(oldMessage, newMessage, client) {
  if (!oldMessage.author || oldMessage.author.bot || !oldMessage.guild) return;
  if (oldMessage.content === newMessage.content) return;

  const fields = [
    { name: 'Before', value: truncate(oldMessage.content, 512) || '*[empty]*', inline: false },
    { name: 'After', value: truncate(newMessage.content, 512) || '*[empty]*', inline: false },
  ];

  fields.push(...attachmentFields(oldMessage));

  await sendLog(
    client,
    oldMessage.guild.id,
    'messages',
    {
      author: { name: 'Message Edited', icon_url: getAvatar(oldMessage.author) ?? undefined },
      description: `Message by <@${oldMessage.author.id}> edited in <#${oldMessage.channel.id}> - [Jump](${newMessage.url})`,
      fields,
      footer: { text: `User ID: ${oldMessage.author.id}` },
      timestamp: new Date().toISOString(),
    },
    { ignoreIds: [oldMessage.author.id] },
  );
}

async function handleMessageBulkDelete(messages, channel, client) {
  if (!channel.guild) return;

  const cached = [...messages.values()].filter((m) => m.author);
  const lines = cached.slice(0, 15).map((m) => {
    const tag = m.author.bot ? `[bot] **${m.author.username}**` : `**${m.author.username}**`;
    const content = truncate(m.content, 60) || (m.attachments?.size ? `[${m.attachments.size} attachment(s)]` : m.embeds?.length ? '[embed]' : '*[empty]*');
    return `${tag}: ${content}`;
  });

  await sendLog(client, channel.guild.id, 'messages', {
    author: { name: 'Bulk Delete' },
    description: `**${messages.size}** messages deleted in <#${channel.id}>`,
    fields: [{ name: 'Cached Messages', value: lines.join('\n').slice(0, 1024) || '*None*', inline: false }],
    footer: { text: `${cached.length} recovered from cache` },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { handleMessageDelete, handleMessageUpdate, handleMessageBulkDelete };
