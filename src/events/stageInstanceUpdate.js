const { Events } = require('discord.js');
const { handleStage } = require('../logging/extraLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.StageInstanceUpdate,
  execute(oldStage, stage, client) {
    return handleStage('update', stage, oldStage, client).catch((err) => logger.error('[stageInstanceUpdate]', err));
  },
};
