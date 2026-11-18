const { Events } = require('discord.js');
const { runModRules } = require('../utils/modRulesEngine');

// The moderation rules a server made in the dashboard (utils/modRules.ts). A server with no rules costs one cached read.
module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    await runModRules(message);
  },
};
