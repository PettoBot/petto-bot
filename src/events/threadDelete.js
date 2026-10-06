const { Events } = require('discord.js');
const { handleThreadDelete } = require('../logging/threadLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ThreadDelete,
  execute(thread, client) {
    return handleThreadDelete(thread, client).catch((err) => logger.error('[threadDelete]', err));
  },
};
