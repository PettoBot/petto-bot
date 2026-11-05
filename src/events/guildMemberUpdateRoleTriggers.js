// Role triggers (`/protect roletrigger`): the action of a rule for a member who is given its role or finishes Discord's onboarding while holding it.
const { Events } = require('discord.js');
const { handleMemberUpdate } = require('../utils/roleTriggers');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberUpdate,
  execute(oldMember, newMember) {
    return handleMemberUpdate(oldMember, newMember).catch((err) => logger.error(`Role triggers: could not look at the update of ${newMember?.id} in guild ${newMember?.guild?.id}:`, err)); // i18n-ignore: a log line for the operator
  },
};
