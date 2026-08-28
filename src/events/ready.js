const { Events, ActivityType } = require('discord.js');
const { warmGuild } = require('../utils/inviteCache');
const logger = require('../utils/logger');
const { attachDiscordLogger, startDiscordStatusJob } = require('../utils/discordOps');
const config = require('../config');
const { syncAllGuildsAutoMod } = require('../utils/autoModManager');
const { forEachWithConcurrency } = require('../utils/concurrency');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    client.user.setPresence({
      status: 'online',
      activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: 'Keeping the server safe', emoji: { name: '🦆' } }],
    });

    logger.info(`Petto is online as ${client.user.tag}, serving ${client.guilds.cache.size} guild(s).`);
    attachDiscordLogger(client);
    startDiscordStatusJob(client);

    // Keep the existing warmup available, but never issue one invite request per guild at once.
    // At very large scale it can be disabled with INVITE_CACHE_WARM_ON_READY=false; joins still
    // use the normal lazy diff path when they happen.
    if (config.inviteCacheWarmOnReady) {
      await forEachWithConcurrency(client.guilds.cache.values(), (guild) => warmGuild(guild), config.inviteCacheWarmConcurrency);
    }

    if (config.automodSyncOnReady) {
      await syncAllGuildsAutoMod(client, { concurrency: config.automodSyncConcurrency }).catch((err) => {
        logger.error('[AutoMod] Startup synchronization failed:', err);
      });
    }
  },
};
