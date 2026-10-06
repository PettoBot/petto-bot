const { Events } = require('discord.js');
const { handleThreadCreate } = require('../logging/threadLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ThreadCreate,
  execute(thread, newlyCreated, client) {
    return handleThreadCreate(thread, newlyCreated, client).catch((err) => logger.error('[threadCreate]', err));
  },
};
