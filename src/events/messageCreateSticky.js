const { Events } = require('discord.js');
const stickyDb = require('../db/stickyMessages');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;

    try {
      const sticky = await stickyDb.getSticky(message.guild.id, message.channel.id);
      if (!sticky || message.id === sticky.message_id) return;

      if (sticky.message_id) {
        const old = await message.channel.messages.fetch(sticky.message_id).catch(() => null);
        if (old) await old.delete().catch(() => {});
      }

      const sent = await message.channel.send({ content: sticky.content }).catch(() => null);
      if (sent) await stickyDb.setMessageId(message.guild.id, message.channel.id, sent.id);
    } catch (err) {
      logger.error(`Sticky message repost failed in channel ${message.channel.id}:`, err);
    }
  },
};
