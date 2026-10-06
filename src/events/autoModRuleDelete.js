const { Events } = require('discord.js');
const { handleRuleDelete } = require('../logging/automodRuleLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.AutoModerationRuleDelete,
  execute(rule, client) {
    return handleRuleDelete(rule, client).catch((err) => logger.error('[autoModRuleDelete]', err));
  },
};
