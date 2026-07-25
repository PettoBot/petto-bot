const { sendLog, fetchMod, AuditLogEvent } = require('./engine');

function getEmojiUrl(emoji) {
  if (!emoji.id) return null;
  return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
}

async function handleEmojiCreate(emoji, client) {
  const mod = await fetchMod(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
  const url = getEmojiUrl(emoji);
  const fields = mod ? [{ name: 'By', value: mod, inline: true }] : [];

  const embed = {
    author: { name: 'Emoji Added', icon_url: url ?? undefined },
    description: `\`:${emoji.name}:\` was added to the server`,
    fields,
    footer: { text: `Emoji ID: ${emoji.id}` },
    timestamp: new Date().toISOString(),
  };
  if (url) embed.image = { url };
  await sendLog(client, emoji.guild.id, 'emojis', embed);
}

async function handleEmojiDelete(emoji, client) {
  const mod = await fetchMod(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
  const fields = mod ? [{ name: 'By', value: mod, inline: true }] : [];

  await sendLog(client, emoji.guild.id, 'emojis', {
    author: { name: 'Emoji Removed' },
    description: `\`:${emoji.name}:\` was removed from the server`,
    fields,
    footer: { text: `Emoji ID: ${emoji.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleEmojiUpdate(oldEmoji, newEmoji, client) {
  if (oldEmoji.name === newEmoji.name) return;
  const mod = await fetchMod(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id);
  const fields = [
    { name: 'Before', value: `\`:${oldEmoji.name}:\``, inline: true },
    { name: 'After', value: `\`:${newEmoji.name}:\``, inline: true },
  ];
  if (mod) fields.push({ name: 'By', value: mod, inline: true });

  await sendLog(client, newEmoji.guild.id, 'emojis', {
    author: { name: 'Emoji Renamed' },
    description: 'An emoji was renamed',
    fields,
    footer: { text: `Emoji ID: ${newEmoji.id}` },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { handleEmojiCreate, handleEmojiDelete, handleEmojiUpdate };
