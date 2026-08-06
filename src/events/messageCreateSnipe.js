const { Events } = require('discord.js');
const { rememberKnown } = require('../utils/snipeCache');

module.exports = {
  name: Events.MessageCreate,
  execute(message) {
    if (!message?.author?.bot) rememberKnown(message);
  },
};
