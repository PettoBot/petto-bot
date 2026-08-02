const { Events, EmbedBuilder } = require('discord.js');
const starboardDb = require('../db/starboard');
const logger = require('../utils/logger');

const busy = new Set();

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;
    await sync(reaction).catch((err) => logger.error('Starboard reaction sync failed:', err));
  },
};

async function sync(reaction) {
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

    const payload = buildPayload(message, row, count);
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

function buildPayload(message, row, count) {
  const embed = new EmbedBuilder().setColor(row.color ?? 0xffc107).setAuthor({ name: message.author?.tag ?? 'Unknown user', iconURL: message.author?.displayAvatarURL?.() }).setDescription(message.content || '*No text content*');
  if (row.timestamp) embed.setTimestamp(message.createdAt);
  const footer = `${count} ${row.emoji} • #${message.channel.name}`;
  embed.setFooter({ text: footer });
  if (row.attachments) {
    const files = [...message.attachments.values()];
    const image = files.find((file) => file.contentType?.startsWith('image/'));
    if (image) embed.setImage(image.url);
    const links = files.filter((file) => file !== image).map((file) => `[${file.name}](${file.url})`);
    if (links.length) embed.addFields({ name: 'Attachments', value: links.join('\n').slice(0, 1024) });
  }
  return { content: row.jumpurl ? `**${message.channel}** [Jump to message](${message.url})` : undefined, embeds: [embed], allowedMentions: { parse: [] } };
}

module.exports.syncStarboard = sync;
