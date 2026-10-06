const { Events } = require('discord.js');
const { handleThreadUpdate } = require('../logging/threadLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ThreadUpdate,
  execute(oldThread, newThread, client) {
    return handleThreadUpdate(oldThread, newThread, client).catch((err) => logger.error('[threadUpdate]', err));
  },
};
