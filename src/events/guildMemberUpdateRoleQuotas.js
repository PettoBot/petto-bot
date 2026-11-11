// Role quotas (`!rolequota`): a member who is given a role with a quota is judged from the next period; one who loses it is forgotten.
const { Events } = require('discord.js');
const { handleMemberUpdate } = require('../utils/roleQuotas');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberUpdate,
  execute(oldMember, newMember) {
    return handleMemberUpdate(oldMember, newMember).catch((err) => logger.warn(`Role quotas: could not look at the update of ${newMember?.id} in guild ${newMember?.guild?.id}: ${err.message}`)); // i18n-ignore: a log line for the operator
  },
};
