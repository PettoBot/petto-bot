const { Events } = require('discord.js');
const { handleOnboardingEntry } = require('../logging/moreLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  execute(...args) {
    const run = (entry, guild, client) => handleOnboardingEntry(entry, guild, client);
    return run(...args).catch((err) => logger.error('[guildAuditLogEntryCreateOnboardingLog]', err));
  },
};
