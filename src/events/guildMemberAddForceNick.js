// A member who leaves and comes back keeps their forced nickname.
const { Events } = require('discord.js');
const { enforce } = require('./guildMemberUpdateForceNick');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    await enforce(member);
  },
};
