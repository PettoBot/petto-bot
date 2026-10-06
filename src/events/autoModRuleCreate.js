const { Events } = require('discord.js');
const { handleRuleCreate } = require('../logging/automodRuleLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.AutoModerationRuleCreate,
  execute(rule, client) {
    return handleRuleCreate(rule, client).catch((err) => logger.error('[autoModRuleCreate]', err));
  },
};
