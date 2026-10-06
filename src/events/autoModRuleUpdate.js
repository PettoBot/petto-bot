const { Events } = require('discord.js');
const { handleRuleUpdate } = require('../logging/automodRuleLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.AutoModerationRuleUpdate,
  execute(oldRule, newRule, client) {
    return handleRuleUpdate(oldRule, newRule, client).catch((err) => logger.error('[autoModRuleUpdate]', err));
  },
};
