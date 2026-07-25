const { Events } = require('discord.js');
const { handleMemberLeave } = require('../logging/memberLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  execute(member, client) {
    return handleMemberLeave(member, client).catch((err) => logger.error('[guildMemberRemove]', err));
  },
};
