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

const STICKER_FORMATS = { 1: 'PNG', 2: 'Animated PNG', 3: 'Lottie', 4: 'GIF' };

function stickerFields(sticker, mod) {
  const fields = [];
  if (sticker.description) fields.push({ name: 'Description', value: sticker.description, inline: false });
  if (sticker.tags) fields.push({ name: 'Emoji', value: sticker.tags, inline: true });
  if (STICKER_FORMATS[sticker.format]) fields.push({ name: 'Format', value: STICKER_FORMATS[sticker.format], inline: true });
  if (mod) fields.push({ name: 'By', value: mod, inline: true });
  return fields;
}

async function handleStickerCreate(sticker, client) {
  if (!sticker.guild) return;
  const mod = await fetchMod(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
  const embed = {
    author: { name: 'Sticker Added' },
    description: `The sticker \`${sticker.name}\` was added to the server`,
    fields: stickerFields(sticker, mod),
    footer: { text: `Sticker ID: ${sticker.id}` },
    timestamp: new Date().toISOString(),
  };
  if (sticker.url) embed.thumbnail = { url: sticker.url };
  await sendLog(client, sticker.guild.id, 'emojis', embed);
}

async function handleStickerDelete(sticker, client) {
  if (!sticker.guild) return;
  const mod = await fetchMod(sticker.guild, AuditLogEvent.StickerDelete, sticker.id);
  await sendLog(client, sticker.guild.id, 'emojis', {
    author: { name: 'Sticker Removed' },
    description: `The sticker \`${sticker.name}\` was removed from the server`,
    fields: stickerFields(sticker, mod),
    footer: { text: `Sticker ID: ${sticker.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleStickerUpdate(oldSticker, newSticker, client) {
  if (!newSticker.guild) return;
  const fields = [];
  if (oldSticker.name !== newSticker.name) fields.push({ name: 'Name', value: `\`${oldSticker.name}\` -> \`${newSticker.name}\``, inline: false });
  if ((oldSticker.description ?? '') !== (newSticker.description ?? '')) fields.push({ name: 'Description', value: `${oldSticker.description || '*None*'} -> ${newSticker.description || '*None*'}`, inline: false });
  if ((oldSticker.tags ?? '') !== (newSticker.tags ?? '')) fields.push({ name: 'Emoji', value: `${oldSticker.tags || '*None*'} -> ${newSticker.tags || '*None*'}`, inline: true });
  if (!fields.length) return;
  const mod = await fetchMod(newSticker.guild, AuditLogEvent.StickerUpdate, newSticker.id);
  if (mod) fields.push({ name: 'By', value: mod, inline: true });
  const embed = {
    author: { name: 'Sticker Updated' },
    description: `The sticker \`${newSticker.name}\` was updated`,
    fields,
    footer: { text: `Sticker ID: ${newSticker.id}` },
    timestamp: new Date().toISOString(),
  };
  if (newSticker.url) embed.thumbnail = { url: newSticker.url };
  await sendLog(client, newSticker.guild.id, 'emojis', embed);
}

module.exports = { handleEmojiCreate, handleEmojiDelete, handleEmojiUpdate, handleStickerCreate, handleStickerDelete, handleStickerUpdate };
