const { Events } = require('discord.js');
const { handleMemberUpdate } = require('../logging/memberLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberUpdate,
  execute(oldMember, newMember, client) {
    return handleMemberUpdate(oldMember, newMember, client).catch((err) => logger.error('[guildMemberUpdate]', err));
  },
};
