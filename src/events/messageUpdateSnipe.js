const { Events } = require('discord.js');
const { rememberEdited } = require('../utils/snipeCache');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage?.guild) return;
    // Without the message as it was there is nothing to show as "before": it is not asked for (it would come back as it is now, a request for nothing).
    if (!oldMessage || oldMessage.partial) return;
    if (newMessage.partial) await newMessage.fetch().catch(() => {});
    rememberEdited(oldMessage, newMessage);
  },
};
