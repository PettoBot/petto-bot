const { Events } = require('discord.js');
const { handleStage } = require('../logging/extraLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.StageInstanceCreate,
  execute(stage, client) {
    return handleStage('create', stage, null, client).catch((err) => logger.error('[stageInstanceCreate]', err));
  },
};
