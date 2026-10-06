const { Events } = require('discord.js');
const { handleWebhooksUpdate } = require('../logging/webhookLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.WebhooksUpdate,
  execute(channel, client) {
    return handleWebhooksUpdate(channel, client).catch((err) => logger.error('[webhooksUpdateLog]', err));
  },
};
