const { Events } = require('discord.js');
const { runJoinGate } = require('../utils/modJoinGate');

// The join gate and the raid detector of the moderation rules (utils/modJoinGate.ts). A server that did not turn them on costs one cached read.
module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    await runJoinGate(member);
  },
};
