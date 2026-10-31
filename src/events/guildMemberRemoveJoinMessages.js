// A member who leaves before finishing the steps of the server is not welcomed: what waited for them is dropped (see utils/joinGate.js).
const { Events } = require('discord.js');
const { onMemberLeave } = require('../utils/joinGate');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  execute(member) {
    return onMemberLeave(member).catch((err) => logger.error(`Join messages: could not drop the wait of ${member?.id} in guild ${member?.guild?.id}:`, err)); // i18n-ignore: a log line for the operator
  },
};
