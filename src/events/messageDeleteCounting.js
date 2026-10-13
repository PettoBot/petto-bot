// Someone deletes the last number of the counting channel: the channel is told what the number was.
const { Events } = require('discord.js');
const { lastNumberOf, tell } = require('./messageUpdateCounting');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    try {
      const config = await lastNumberOf(message);
      if (!config) return;
      const who = config.last_user_id ? `<@${config.last_user_id}>` : 'Someone';
      await tell(message.guild, message.channel, `${who} deleted their number. The last number was **${config.current_number}**, so the next one is **${Number(config.current_number) + 1}**.`);
    } catch (error) {
      logger.error('Counting delete check failed:', error);
    }
  },
};
