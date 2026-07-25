const { Events } = require('discord.js');
const { handleMemberJoin } = require('../logging/memberLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  execute(member, client) {
    return handleMemberJoin(member, client).catch((err) => logger.error('[guildMemberAdd]', err));
  },
};
