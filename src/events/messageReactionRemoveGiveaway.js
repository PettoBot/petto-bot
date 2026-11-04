const { Events } = require('discord.js');
const giveawaysDb = require('../db/giveaways');
const { refreshGiveawayMessage } = require('../utils/giveawayEngine');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction, user) {
    if (user.bot || !reaction.message.guild) return;

    try {
      // No request to Discord here: the id of the message and the emoji (all this needs) come with the event, and completing the reaction cost one request for every reaction of every server.
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
