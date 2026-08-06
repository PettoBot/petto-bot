const { Events } = require('discord.js');
const { rememberEdited } = require('../utils/snipeCache');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage?.guild) return;
    if (oldMessage.partial) await oldMessage.fetch().catch(() => {});
    if (newMessage.partial) await newMessage.fetch().catch(() => {});
    rememberEdited(oldMessage, newMessage);
  },
};
