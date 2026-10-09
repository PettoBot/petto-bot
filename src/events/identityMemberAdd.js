const { Events } = require('discord.js');
const { evaluateMember } = require('../utils/identity/service');

// A member who joins is checked against the Vanity and Server Tag rules of the server.
module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    await evaluateMember(member);
  },
};
