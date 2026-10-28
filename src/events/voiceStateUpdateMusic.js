// The music leaves the voice channel when nobody is left in it, and forgets the server when the bot is taken out of the channel.
const { Events } = require('discord.js');
const service = require('../music/service');
const logger = require('../utils/logger');

module.exports = {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    try { service.onVoiceState(oldState, newState); } catch (error) { logger.warn(`Music: a voice change could not be handled: ${error?.message ?? error}`); }
  },
};
