const { Events } = require('discord.js');
const giveawaysDb = require('../db/giveaways');
const { refreshGiveawayMessage } = require('../utils/giveawayEngine');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction, user) {
    if (user.bot || !reaction.message.guild) return;

    try {
      if (reaction.partial) await reaction.fetch().catch(() => null);
      const giveaway = await giveawaysDb.getGiveawayByMessageId(reaction.message.guild.id, reaction.message.id);
      if (!giveaway || giveaway.ended || giveaway.entry_mode !== 'reaction') return;
      if (reaction.emoji.toString() !== giveaway.reaction) return;

      await giveawaysDb.removeEntry(giveaway.id, user.id);
      await refreshGiveawayMessage(reaction.message.channel, giveaway);
    } catch {
      // Best-effort.
    }
  },
};
