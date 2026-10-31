// A member Petto did not have in memory (after a restart, for instance) whose update arrives: Discord gives it as "available" and not as an update, so
// the join messages that waited for that member (utils/joinGate.js) look at it here too.
const { Events } = require('discord.js');
const { onMemberChange } = require('../utils/joinGate');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAvailable,
  execute(member) {
    return onMemberChange(null, member).catch((err) => logger.error(`Join messages: could not look at ${member?.id} in guild ${member?.guild?.id}:`, err)); // i18n-ignore: a log line for the operator
  },
};
