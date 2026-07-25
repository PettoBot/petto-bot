const { Events } = require('discord.js');
const { handleUserUpdate } = require('../logging/memberLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.UserUpdate,
  execute(oldUser, newUser, client) {
    return handleUserUpdate(oldUser, newUser, client).catch((err) => logger.error('[userUpdate]', err));
  },
};
