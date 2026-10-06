const { Events } = require('discord.js');
const { handleStage } = require('../logging/extraLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.StageInstanceDelete,
  execute(stage, client) {
    return handleStage('delete', stage, null, client).catch((err) => logger.error('[stageInstanceDelete]', err));
  },
};
