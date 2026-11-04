const { Events } = require('discord.js');
const { rememberReactionRemoved } = require('../utils/snipeCache');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction, user) {
    if (!reaction?.message?.guild) return;
    // Nothing is fetched from Discord: a reaction that is already gone cannot always be fetched, and up to three requests for every reaction removed in every server filled the queue of
    // requests of the bot. What the event gives is used (the message, the emoji and the member are known by id and name; the text of an uncached message is left out), and one with no emoji
    // name is dropped.
    if (!user || user.bot) return;
    rememberReactionRemoved(reaction, user);
  },
};
