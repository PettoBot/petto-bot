const { Events } = require('discord.js');
const { handleVoiceState } = require('../logging/voiceLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState, client) {
    return handleVoiceState(oldState, newState, client).catch((err) => logger.error('[voiceStateUpdate]', err));
  },
};
