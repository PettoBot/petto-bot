const { Events } = require('discord.js');
const { queueActivity } = require('../db/activityStats');
const { queueMessage, queueContent } = require('../db/activityDetail');
const statsRules = require('../db/statsRules');

const LINK = /https?:\/\/\S+/i;

module.exports = {
  name: Events.MessageCreate,
  execute(message) {
    if (message.author.bot || !message.guild) return;
    // A server that turned the counters off, or a person who asked not to be counted, adds nothing (`!stats privacy`, `!statsconfig`).
    const rules = statsRules.allowed(message.guild.id, message.author.id);
    if (!rules) return;
    queueActivity(message.guild.id, message.channel.id, { messages: 1 });
    queueMessage(message.guild.id, message.author.id, { member: rules.members });
    // Only whether the message carried something is counted, never what it said.
    if (rules.content) {
      queueContent(message.guild.id, {
        links: LINK.test(message.content ?? '') ? 1 : 0,
        attachments: message.attachments?.size ? 1 : 0,
        replies: message.reference?.messageId ? 1 : 0,
        mentions: message.mentions?.users?.size ? 1 : 0,
      });
    }
  },
};
