const { Events } = require('discord.js');
const { handleCommandPermissions } = require('../logging/moreLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ApplicationCommandPermissionsUpdate,
  execute(...args) {
    const run = (data, client) => handleCommandPermissions(data, client);
    return run(...args).catch((err) => logger.error('[applicationCommandPermissionsUpdateLog]', err));
  },
};
