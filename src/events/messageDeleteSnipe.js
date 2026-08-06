const { Events } = require('discord.js');
const { rememberDeleted } = require('../utils/snipeCache');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message?.guild) return;
    if (message.partial) await message.fetch().catch(() => {});
    rememberDeleted(message);
  },
};
