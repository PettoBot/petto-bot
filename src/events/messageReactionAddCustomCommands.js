// Someone reacted to a message that a custom command sent with "reactions": the command runs again, see runReaction.
const { Events } = require('discord.js');
const ccDb = require('../db/customCommands');
const commandData = require('../db/commandData');
const { runReaction, matchEmoji } = require('../utils/codeCommands');
const logger = require('../utils/logger');

// Messages that were looked up and are not watched, so a busy message does not cost a read for every reaction. Only a message that is
// not new is kept here: a new one may be written down a moment after it is sent, and must not be skipped for that.
const unwatched = new Map();
const SKIP_MS = 60 * 1000;
const NEW_MS = 2 * 60 * 1000;

async function lookup(guildId, messageId) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await commandData.forGuild(guildId).watched(messageId); } catch (error) {
      if (attempt >= 1) { logger.warn(`Could not read the reactions of a message in guild ${guildId}: ${error.message}`); return undefined; }
    }
  }
}

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;
    try {
      // Asked by the id of the message first (it comes with the event): nearly every reaction is on a message nobody watches, and completing the message from Discord for each of them
      // (a request for every reaction of every server, up to 5 handlers doing it) filled the queue of requests of the bot. Only a watched message is completed.
      const guildId = reaction.message.guildId ?? reaction.message.guild?.id;
      if (!guildId) return;
      const messageId = reaction.message.id;
      const until = unwatched.get(messageId);
      if (until && until > Date.now()) return;

      const watched = await lookup(guildId, messageId);
      if (watched === undefined) return;
      if (!watched) {
        const isNew = Date.now() - (reaction.message.createdTimestamp ?? 0) < NEW_MS;
        if (!isNew) { unwatched.set(messageId, Date.now() + SKIP_MS); if (unwatched.size > 5000) unwatched.delete(unwatched.keys().next().value); }
        return;
      }
      if (reaction.partial) await reaction.fetch().catch(() => null);
      if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
      const message = reaction.message;
      if (!message.guild) return;
      // Only messages of the bot can be watched. If the author is not known (a message that could not be read), what the lookup said stands.
      if (message.author && message.author.id !== message.client.user.id) return;
      const emoji = matchEmoji(watched.emojis, reaction.emoji.toString());
      if (!emoji) return;
      const row = await ccDb.getCommand(message.guild.id, watched.command).catch(() => null);
      if (!row?.code) return;
      await runReaction(reaction, user, row, emoji, watched);
    } catch (error) {
      logger.error('Custom command reaction failed:', error);
    }
  },
};
