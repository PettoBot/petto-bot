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
      if (reaction.partial) await reaction.fetch().catch(() => null);
      if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
      const message = reaction.message;
      if (!message.guild) return;
      // Only messages of the bot can be watched. If the author is not known (a message that could not be read), the lookup decides.
      if (message.author && message.author.id !== message.client.user.id) return;
      const until = unwatched.get(message.id);
      if (until && until > Date.now()) return;

      const watched = await lookup(message.guild.id, message.id);
      if (watched === undefined) return;
      if (!watched) {
        const isNew = Date.now() - (message.createdTimestamp ?? 0) < NEW_MS;
        if (!isNew) { unwatched.set(message.id, Date.now() + SKIP_MS); if (unwatched.size > 5000) unwatched.delete(unwatched.keys().next().value); }
        return;
      }
      const emoji = matchEmoji(watched.emojis, reaction.emoji.toString());
      if (!emoji) return;
      const row = await ccDb.getCommand(message.guild.id, watched.command).catch(() => null);
      if (!row?.code) return;
      await runReaction(reaction, user, row, emoji);
    } catch (error) {
      logger.error('Custom command reaction failed:', error);
    }
  },
};
