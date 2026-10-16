const { sendLog, fetchMod, AuditLogEvent } = require('./engine');
const { t, guildLanguage } = require('../i18n');

function getEmojiUrl(emoji) {
  if (!emoji.id) return null;
  return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
}

async function handleEmojiCreate(emoji, client) {
  const lang = await guildLanguage(emoji.guild.id);
  const mod = await fetchMod(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
  const url = getEmojiUrl(emoji);
  const fields = mod ? [{ name: t(lang, 'logs.field.by'), value: mod, inline: true }] : [];

  const embed = {
    author: { name: t(lang, 'logs.emoji.added.title'), icon_url: url ?? undefined },
    description: t(lang, 'logs.emoji.added.description', { name: emoji.name }),
    fields,
    footer: { text: t(lang, 'logs.emoji.footer', { id: emoji.id }) },
    timestamp: new Date().toISOString(),
  };
  if (url) embed.image = { url };
  await sendLog(client, emoji.guild.id, 'emojis', embed);
}

async function handleEmojiDelete(emoji, client) {
  const lang = await guildLanguage(emoji.guild.id);
  const mod = await fetchMod(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
  const fields = mod ? [{ name: t(lang, 'logs.field.by'), value: mod, inline: true }] : [];

  await sendLog(client, emoji.guild.id, 'emojis', {
    author: { name: t(lang, 'logs.emoji.removed.title') },
    description: t(lang, 'logs.emoji.removed.description', { name: emoji.name }),
    fields,
    footer: { text: t(lang, 'logs.emoji.footer', { id: emoji.id }) },
    timestamp: new Date().toISOString(),
  });
}

/** The ids of the roles an emoji is limited to (none: everyone can use it). */
const emojiRoleIds = (emoji) => [...(emoji.roles?.cache?.keys?.() ?? [])].sort();

async function handleEmojiUpdate(oldEmoji, newEmoji, client) {
  const renamed = oldEmoji.name !== newEmoji.name;
  const before = emojiRoleIds(oldEmoji);
  const after = emojiRoleIds(newEmoji);
  const rolesChanged = before.join() !== after.join();
  if (!renamed && !rolesChanged) return;
  const lang = await guildLanguage(newEmoji.guild.id);
  const mod = await fetchMod(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id);
  const fields = [];
  if (renamed) {
    fields.push(
      { name: t(lang, 'logs.field.before'), value: `\`:${oldEmoji.name}:\``, inline: true },
      { name: t(lang, 'logs.field.after'), value: `\`:${newEmoji.name}:\``, inline: true },
    );
  } else {
    fields.push({ name: t(lang, 'logs.field.emoji'), value: `\`:${newEmoji.name}:\``, inline: true });
  }
  if (rolesChanged) {
    const list = (ids) => (ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : t(lang, 'logs.emoji.everyone'));
    fields.push({ name: t(lang, 'logs.emoji.roles'), value: `${list(before)} -> ${list(after)}`, inline: false });
  }
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });

  await sendLog(client, newEmoji.guild.id, 'emojis', {
    author: { name: t(lang, renamed ? 'logs.emoji.renamed.title' : 'logs.emoji.rolesChanged.title') },
    description: t(lang, renamed ? 'logs.emoji.renamed.description' : 'logs.emoji.rolesChanged.description'),
    fields,
    footer: { text: t(lang, 'logs.emoji.footer', { id: newEmoji.id }) },
    timestamp: new Date().toISOString(),
  });
}

// The names of the formats (PNG, Lottie, GIF) are the same in every language; only "Animated PNG" is translated.
const STICKER_FORMATS = { 1: 'png', 2: 'apng', 3: 'lottie', 4: 'gif' };

function stickerFields(sticker, mod, lang) {
  const fields = [];
  if (sticker.description) fields.push({ name: t(lang, 'logs.field.description'), value: sticker.description, inline: false });
  if (sticker.tags) fields.push({ name: t(lang, 'logs.field.emoji'), value: sticker.tags, inline: true });
  if (STICKER_FORMATS[sticker.format]) fields.push({ name: t(lang, 'logs.field.format'), value: t(lang, `logs.sticker.format.${STICKER_FORMATS[sticker.format]}`), inline: true });
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });
  return fields;
}

async function handleStickerCreate(sticker, client) {
  if (!sticker.guild) return;
  const lang = await guildLanguage(sticker.guild.id);
  const mod = await fetchMod(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
  const embed = {
    author: { name: t(lang, 'logs.sticker.added.title') },
    description: t(lang, 'logs.sticker.added.description', { name: sticker.name }),
    fields: stickerFields(sticker, mod, lang),
    footer: { text: t(lang, 'logs.sticker.footer', { id: sticker.id }) },
    timestamp: new Date().toISOString(),
  };
  if (sticker.url) embed.thumbnail = { url: sticker.url };
  await sendLog(client, sticker.guild.id, 'emojis', embed);
}

async function handleStickerDelete(sticker, client) {
  if (!sticker.guild) return;
  const lang = await guildLanguage(sticker.guild.id);
  const mod = await fetchMod(sticker.guild, AuditLogEvent.StickerDelete, sticker.id);
  await sendLog(client, sticker.guild.id, 'emojis', {
    author: { name: t(lang, 'logs.sticker.removed.title') },
    description: t(lang, 'logs.sticker.removed.description', { name: sticker.name }),
    fields: stickerFields(sticker, mod, lang),
    footer: { text: t(lang, 'logs.sticker.footer', { id: sticker.id }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleStickerUpdate(oldSticker, newSticker, client) {
  if (!newSticker.guild) return;
  const lang = await guildLanguage(newSticker.guild.id);
  const none = t(lang, 'logs.noneItalic');
  const fields = [];
  if (oldSticker.name !== newSticker.name) fields.push({ name: t(lang, 'logs.field.name'), value: `\`${oldSticker.name}\` -> \`${newSticker.name}\``, inline: false });
  if ((oldSticker.description ?? '') !== (newSticker.description ?? '')) fields.push({ name: t(lang, 'logs.field.description'), value: `${oldSticker.description || none} -> ${newSticker.description || none}`, inline: false });
  if ((oldSticker.tags ?? '') !== (newSticker.tags ?? '')) fields.push({ name: t(lang, 'logs.field.emoji'), value: `${oldSticker.tags || none} -> ${newSticker.tags || none}`, inline: true });
  if (!fields.length) return;
  const mod = await fetchMod(newSticker.guild, AuditLogEvent.StickerUpdate, newSticker.id);
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });
  const embed = {
    author: { name: t(lang, 'logs.sticker.updated.title') },
    description: t(lang, 'logs.sticker.updated.description', { name: newSticker.name }),
    fields,
    footer: { text: t(lang, 'logs.sticker.footer', { id: newSticker.id }) },
    timestamp: new Date().toISOString(),
  };
  if (newSticker.url) embed.thumbnail = { url: newSticker.url };
  await sendLog(client, newSticker.guild.id, 'emojis', embed);
}

module.exports = { handleEmojiCreate, handleEmojiDelete, handleEmojiUpdate, handleStickerCreate, handleStickerDelete, handleStickerUpdate };
