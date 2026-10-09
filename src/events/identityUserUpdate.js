const { Events } = require('discord.js');
const { evaluateMember } = require('../utils/identity/service');

// A change of username, global name or Server Tag reaches every server the user shares with the bot.
module.exports = {
  name: Events.UserUpdate,
  async execute(oldUser, newUser, client) {
    if (newUser.bot) return;
    const same = oldUser.username === newUser.username
      && oldUser.globalName === newUser.globalName
      && oldUser.primaryGuild?.tag === newUser.primaryGuild?.tag
      && oldUser.primaryGuild?.identityGuildId === newUser.primaryGuild?.identityGuildId
      && oldUser.primaryGuild?.identityEnabled === newUser.primaryGuild?.identityEnabled;
    if (same) return;
    for (const guild of client.guilds.cache.values()) {
      const member = guild.members.cache.get(newUser.id);
      if (member) await evaluateMember(member);
    }
  },
};
