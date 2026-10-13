const { Events } = require('discord.js');
const { noteMember } = require('../utils/identityHistory');

// A new nickname of a member is added to their history.
module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (oldMember.nickname === newMember.nickname) return;
    await noteMember(newMember);
  },
};
