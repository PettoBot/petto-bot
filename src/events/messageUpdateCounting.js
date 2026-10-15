// Someone edits or deletes the last number: the channel is told what the number was, so nobody counts from a wrong one.
const { Events } = require('discord.js');
const db = require('../db/counting');
const { plainCard } = require('../utils/plainCard');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');
const { deleteLater } = require('../utils/counting');

async function tell(guild, channel, text, seconds = 0) {
  const sent = await channel.send({ ...plainCard(text, 0xffd563), allowedMentions: { parse: [], users: [] } }).catch(() => null);
  deleteLater(sent, seconds);
}

async function lastNumberOf(message) {
  if (!message.guild) return null;
  const config = await db.getConfig(message.guild.id);
  if (!config.enabled || !config.announce_edits || !config.channel_id || message.channel?.id !== config.channel_id) return null;
  return config.last_message_id && message.id === config.last_message_id ? config : null;
}

module.exports = {
  name: Events.MessageUpdate,
  async execute(before, after) {
    try {
      if (before.content === after.content) return;
      const config = await lastNumberOf(after);
      if (!config) return;
      const vars = { user: `<@${config.last_user_id}>`, last: config.current_number, next: Number(config.current_number) + 1 };
      await tell(after.guild, after.channel, t(currentLanguage(), config.last_user_id ? 'counting.edited' : 'counting.editedSomeone', vars), config.alert_seconds);
    } catch (error) {
      logger.error('Counting edit check failed:', error);
    }
  },
  lastNumberOf,
  tell,
};
