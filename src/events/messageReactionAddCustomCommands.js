// Someone reacted to a message that a custom command sent with "reactions": the command runs again, see runReaction.
const { Events } = require('discord.js');
const ccDb = require('../db/customCommands');
const commandData = require('../db/commandData');
const { runReaction } = require('../utils/codeCommands');
const logger = require('../utils/logger');

const unwatched = new Map(); // message id -> until when to skip the lookup, so busy messages do not cost a read each time
const SKIP_MS = 5 * 60 * 1000;

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;
    try {
      if (reaction.partial) await reaction.fetch().catch(() => null);
      if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
      const message = reaction.message;
      if (!message.guild || message.author?.id !== message.client.user.id) return;
      const until = unwatched.get(message.id);
      if (until && until > Date.now()) return;

      const watched = await commandData.forGuild(message.guild.id).watched(message.id);
      const emojiText = reaction.emoji.toString();
      if (!watched || !watched.emojis?.includes(emojiText)) {
        if (!watched) { unwatched.set(message.id, Date.now() + SKIP_MS); if (unwatched.size > 5000) unwatched.delete(unwatched.keys().next().value); }
        return;
      }
      const row = await ccDb.getCommand(message.guild.id, watched.command).catch(() => null);
      if (!row?.code) return;
      await runReaction(reaction, user, row, emojiText);
    } catch (error) {
      logger.error('Custom command reaction failed:', error);
    }
  },
};
