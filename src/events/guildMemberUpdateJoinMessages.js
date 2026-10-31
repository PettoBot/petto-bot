// The join messages that waited for a member (see utils/joinGate.js) go out when the member accepts the rules or finishes Discord's onboarding.
const { Events } = require('discord.js');
const { onMemberChange } = require('../utils/joinGate');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberUpdate,
  execute(oldMember, newMember) {
    return onMemberChange(oldMember, newMember).catch((err) => logger.error(`Join messages: could not look at the update of ${newMember?.id} in guild ${newMember?.guild?.id}:`, err)); // i18n-ignore: a log line for the operator
  },
};
