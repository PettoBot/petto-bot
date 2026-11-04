const { Events } = require('discord.js');
const { rememberDeleted } = require('../utils/snipeCache');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message?.guild) return;
    // A message that was deleted cannot be fetched: asking Discord for it only fills the queue of requests with a 404.
    rememberDeleted(message);
  },
};
