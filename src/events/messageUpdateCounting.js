// Someone edits or deletes the last number: the channel is told what the number was, so nobody counts from a wrong one.
const { Events } = require('discord.js');
const db = require('../db/counting');
const { plainCard } = require('../utils/plainCard');
const logger = require('../utils/logger');
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
      const who = config.last_user_id ? `<@${config.last_user_id}>` : 'Someone';
      await tell(after.guild, after.channel, `${who} edited their number. The last number is **${config.current_number}**, so the next one is **${Number(config.current_number) + 1}**.`, config.alert_seconds);
    } catch (error) {
      logger.error('Counting edit check failed:', error);
    }
  },
  lastNumberOf,
  tell,
};
