// Role quotas (`!rolequota`): counts the messages of members who hold a role with a quota.
const { Events } = require('discord.js');
const { noteMessage } = require('../utils/roleQuotas');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  execute(message) {
    return noteMessage(message).catch((err) => logger.warn(`Role quotas: could not count a message in guild ${message?.guild?.id}: ${err.message}`)); // i18n-ignore: a log line for the operator
  },
};
