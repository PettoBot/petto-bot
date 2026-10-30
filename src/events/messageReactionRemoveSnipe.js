const { Events } = require('discord.js');
const { rememberReactionRemoved } = require('../utils/snipeCache');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction, user) {
    if (!reaction?.message?.guild) return;
    if (user?.partial) await user.fetch().catch(() => {});
    if (!user || user.bot) return;
    // A reaction that is already gone cannot always be fetched: what Discord gave is used, and one with no emoji name is dropped.
    if (reaction.partial) await reaction.fetch().catch(() => {});
    if (reaction.message.partial) await reaction.message.fetch().catch(() => {});
    rememberReactionRemoved(reaction, user);
  },
};
