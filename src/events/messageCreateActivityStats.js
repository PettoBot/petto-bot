const { Events } = require('discord.js');
const { queueActivity } = require('../db/activityStats');

module.exports = {
  name: Events.MessageCreate,
  execute(message) {
    if (message.author.bot || !message.guild) return;
    queueActivity(message.guild.id, message.channel.id, { messages: 1 });
  },
};
