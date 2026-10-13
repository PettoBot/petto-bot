const { Events } = require('discord.js');
const { noteUser, noteMember } = require('../utils/identityHistory');

// The first time Petto sees a person (they join a server it is in), what they show now is the start of their history.
module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    await noteUser(member.user);
    await noteMember(member);
  },
};
