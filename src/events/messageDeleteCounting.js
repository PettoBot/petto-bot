// Someone deletes the last number of the counting channel: the channel is told what the number was.
const { Events } = require('discord.js');
const { lastNumberOf, tell } = require('./messageUpdateCounting');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    try {
      const config = await lastNumberOf(message);
      if (!config) return;
      const vars = { user: `<@${config.last_user_id}>`, last: config.current_number, next: Number(config.current_number) + 1 };
      await tell(message.guild, message.channel, t(currentLanguage(), config.last_user_id ? 'counting.deleted' : 'counting.deletedSomeone', vars), config.alert_seconds);
    } catch (error) {
      logger.error('Counting delete check failed:', error);
    }
  },
};
