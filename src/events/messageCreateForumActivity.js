// Forum support: a message in a post keeps the time of the last one (what the quiet-posts job reads). Only messages of people in the posts of a
// forum count, and a post is written at most once every few minutes: the memory throttle spares the database most messages, and the query
// has the same condition, so it holds across restarts too. The map is small: one entry per post that was written in lately.
const { Events, ChannelType } = require('discord.js');
const forumsDb = require('../db/forums');
const logger = require('../utils/logger');

const EVERY_MS = 5 * 60_000;
const MAX_ENTRIES = 1000;
const seen = new Map(); // thread id -> time of the last write

function worthWriting(threadId, now = Date.now()) {
  const last = seen.get(threadId);
  if (last !== undefined && now - last < EVERY_MS) return false;
  if (seen.size >= MAX_ENTRIES) {
    for (const [id, at] of seen) if (now - at >= EVERY_MS) seen.delete(id);
    if (seen.size >= MAX_ENTRIES) seen.delete(seen.keys().next().value);
  }
  seen.set(threadId, now);
  return true;
}

module.exports = {
  name: Events.MessageCreate,
  seen,
  worthWriting,
  async execute(message) {
    if (!message.guild || message.author?.bot || !message.channel?.isThread?.()) return;
    if (message.channel.parent?.type !== ChannelType.GuildForum) return;
    if (!worthWriting(message.channel.id)) return;
    try {
      await forumsDb.touchActivity(message.channel.id, EVERY_MS);
    } catch (error) {
      logger.warn(`Forums: could not keep the time of a message: ${error.message}`);
    }
  },
};
