const { Events } = require('discord.js');
const { runModRules } = require('../utils/modRulesEngine');

// A message that is edited is looked at again by the moderation rules (somebody can post a clean message and edit the bad word in). Only when the text changed: Discord also
// sends this event when it adds an embed to a link.
module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild) return;
    const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
    if (!message || !message.member) return;
    if (oldMessage && !oldMessage.partial && oldMessage.content === message.content) return;
    await runModRules(message, { edited: true });
  },
};
