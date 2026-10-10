const { Events } = require('discord.js');
const stickyDb = require('../db/stickyMessages');
const { stickyPayload } = require('../utils/stickyPayload');
const { applyReactReplies } = require('../utils/messageFlags');
const logger = require('../utils/logger');

// A burst of messages moves the sticky once, a few seconds after the last one, instead of deleting and posting it for every message.
const REPOST_DELAY_MS = 3_000;
const pending = new Map();

async function repost(message) {
  try {
    const sticky = await stickyDb.getSticky(message.guild.id, message.channel.id);
    if (!sticky) return;

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
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    const sticky = await stickyDb.getSticky(message.guild.id, message.channel.id).catch(() => null);
    if (!sticky || message.id === sticky.message_id) return;
    const key = message.channel.id;
    clearTimeout(pending.get(key));
    const timer = setTimeout(() => { pending.delete(key); repost(message); }, REPOST_DELAY_MS);
    timer.unref?.();
    pending.set(key, timer);
  },
};
