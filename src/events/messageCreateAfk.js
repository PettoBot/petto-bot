const { Events } = require('discord.js');
const afkDb = require('../db/afk');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;

    try {
      // Mentioning an AFK member — flag it back and log it for their /afk mentions.
      if (message.mentions.users.size > 0) {
        for (const user of message.mentions.users.values()) {
          if (user.id === message.author.id || user.bot) continue;

          const afk = await afkDb.getStatus(message.guild.id, user.id);
          if (!afk) continue;

          await afkDb.recordMention(message.guild.id, user.id, {
            mentionedBy: message.author.id,
            channelId: message.channel.id,
            messageLink: `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`,
            content: message.content.slice(0, 100),
          });

          const ts = `<t:${Math.floor(new Date(afk.set_at).getTime() / 1000)}:R>`;
          await message
            .reply({ content: `**${user.username}** is AFK ${ts}: **${afk.reason}**`, allowedMentions: { repliedUser: false } })
            .catch(() => {});
        }
      }

      // The author's own next message clears their AFK status.
      const authorAfk = await afkDb.clearStatus(message.guild.id, message.author.id);
      if (authorAfk) {
        const count = await afkDb.countRecentMentions(message.guild.id, message.author.id);
        await message
          .reply({
            content: `Welcome back, **${message.author.username}**! You're no longer AFK.${count ? ` You have **${count}** mention(s) — use \`/afk mentions\` to view them.` : ''}`,
            allowedMentions: { repliedUser: false },
          })
          .catch(() => {});
      }
    } catch (err) {
      logger.error(`AFK handling failed for message ${message.id}:`, err);
    }
  },
};
