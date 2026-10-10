const { Events } = require('discord.js');
const { queueActivity } = require('../db/activityStats');
const { queueMessage } = require('../db/activityDetail');

module.exports = {
  name: Events.MessageCreate,
  execute(message) {
    if (message.author.bot || !message.guild) return;
    queueActivity(message.guild.id, message.channel.id, { messages: 1 });
    queueMessage(message.guild.id, message.author.id);
  },
};
