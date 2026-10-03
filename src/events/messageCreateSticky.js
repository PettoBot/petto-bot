const { Events } = require('discord.js');
const stickyDb = require('../db/stickyMessages');
const { stickyPayload } = require('../utils/stickyPayload');
const { applyReactReplies } = require('../utils/messageFlags');
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

      const payload = await stickyPayload(sticky, message);
      if (!payload) return;
      const sent = await message.channel.send(payload).catch(() => null);
      if (sent) {
        await stickyDb.setMessageId(message.guild.id, message.channel.id, sent.id);
        if (payload.reactions?.length) await applyReactReplies(sent, payload.reactions);
      }
    } catch (err) {
      logger.error(`Sticky message repost failed in channel ${message.channel.id}:`, err);
    }
  },
};
