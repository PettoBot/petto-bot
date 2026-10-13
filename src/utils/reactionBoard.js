// A reaction board (the starboard, the monkeyboard): when enough people react to a message with the board's emoji, it is reposted in the
// board's channel, and the repost follows the count (and goes away when the reactions are taken back). Each board brings its own
// storage (`db`, see db/boardStore.js); the rules are the same.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');
const { templatePayload } = require('./templatedMessage');

// Messages being synced, per board, so two reactions at once do not post the same message twice.
const busyByBoard = new WeakMap();

/** Brings the repost of the message `reaction` belongs to up to date for the board `{ db }`. */
async function syncBoard(reaction, board) {
  const starboardDb = board.db;
  const busy = busyByBoard.get(board.db) ?? busyByBoard.set(board.db, new Set()).get(board.db);
  if (!reaction.message.guild) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const message = reaction.message;
  const row = await starboardDb.getConfig(message.guild.id);
  if (!row?.channel_id || reaction.emoji.toString() !== row.emoji) return;
  if (busy.has(message.id)) return;
  busy.add(message.id);
  try {
    const ignored = row.ignored_channel_ids?.includes(message.channel.id) || row.ignored_user_ids?.includes(message.author?.id);
    const member = await message.guild.members.fetch(message.author?.id).catch(() => null);
    const ignoredRole = member?.roles.cache.some((role) => row.ignored_role_ids?.includes(role.id));
    if (ignored || ignoredRole) return;

    const users = await reaction.users.fetch();
    const count = users.filter((memberUser) => !memberUser.bot && (row.selfstar || memberUser.id !== message.author?.id)).size;
    const entry = await starboardDb.getEntry(message.guild.id, message.id);
    const destination = await message.guild.channels.fetch(row.channel_id).catch(() => null);
    if (!destination?.isTextBased()) return;

    if (count < row.threshold) {
      if (entry) {
        const repost = await destination.messages.fetch(entry.starboard_message_id).catch(() => null);
        await repost?.delete().catch(() => {});
        await starboardDb.removeEntry(message.guild.id, message.id);
      }
      return;
    }

    const payload = await buildCustomPayload(message, row, count, board.variable) ?? buildPayload(message, row, count);
    if (entry) {
      const repost = await destination.messages.fetch(entry.starboard_message_id).catch(() => null);
      if (repost) {
        await repost.edit(payload);
        await starboardDb.saveEntry({ guildId: message.guild.id, sourceMessageId: message.id, starboardMessageId: repost.id, count });
        return;
      }
    }
    const repost = await destination.send(payload);
    await starboardDb.saveEntry({ guildId: message.guild.id, sourceMessageId: message.id, starboardMessageId: repost.id, count });
  } finally {
    busy.delete(message.id);
  }
}

// A saved embed chosen in the dashboard replaces the usual repost; a missing or broken one falls back to it.
async function buildCustomPayload(message, row, count, variable = 'star') {
  if (!row.embed_template) return null;
  const files = [...message.attachments.values()];
  const image = files.find((file) => file.contentType?.startsWith('image/'));
  const links = files.filter((file) => file !== image).map((file) => `[${file.name}](${file.url})`);
  const star = {
    count,
    emoji: row.emoji,
    channelId: message.channel.id,
    channelName: message.channel.name,
    link: message.url,
    messageId: message.id,
    author: { id: message.author?.id, name: message.author?.username ?? 'Unknown user', avatar: message.author?.displayAvatarURL?.() },
    content: message.content,
    image: image?.url ?? '',
    attachments: links.join('\n'),
    unix: Math.floor((message.createdTimestamp ?? Date.now()) / 1000),
  };
  // The variables are `{star.…}` on the starboard and `{monkey.…}` on the monkeyboard.
  const payload = await templatePayload(message.guild.id, row.embed_template, { guild: message.guild, user: message.author, member: message.member, channel: message.channel, [variable]: star });
  return payload ? { ...payload, allowedMentions: { parse: [] } } : null;
}

// The usual repost: "⭐ 3 | #channel" over the original message (author, text, picture and date), and a button to go to it.
function buildPayload(message, row, count) {
  const embed = new EmbedBuilder().setColor(row.color ?? 0xffc107)
    .setAuthor({ name: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? 'Unknown user', iconURL: message.member?.displayAvatarURL?.() ?? message.author?.displayAvatarURL?.() })
    .setDescription(message.content || null);
  if (row.timestamp !== false) embed.setTimestamp(message.createdAt);
  const files = [...message.attachments.values()];
  const image = row.attachments !== false ? files.find((file) => file.contentType?.startsWith('image/')) : null;
  if (image) embed.setImage(image.url);
  const links = row.attachments !== false ? files.filter((file) => file !== image).map((file) => `[${file.name}](${file.url})`) : [];
  if (links.length) embed.addFields({ name: 'Attachments', value: links.join('\n').slice(0, 1024) });
  if (!message.content && !image && !links.length) embed.setDescription('*No text content*');
  const payload = { content: `${row.emoji} **${count}** | ${message.channel}`, embeds: [embed], allowedMentions: { parse: [] } };
  if (row.jumpurl !== false) {
    payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Original Message').setURL(message.url))];
  }
  return payload;
}

module.exports = { syncBoard, buildCustomPayload, buildPayload };
