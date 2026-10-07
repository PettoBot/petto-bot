const { Events, ActivityType } = require('discord.js');
const { warmGuild } = require('../utils/inviteCache');
const logger = require('../utils/logger');
const { attachDiscordLogger, startDiscordStatusJob } = require('../utils/discordOps');
const config = require('../config');
const { syncAllGuildsAutoMod } = require('../utils/autoModManager');
const { forEachWithConcurrency } = require('../utils/concurrency');

/** A while after connecting, says in the log how Discord sees the bot (for example `{"mobile":"idle"}`), to check the phone icon without a screenshot. */
function reportMobileStatus(client) {
  const { currentIdentify } = require('../utils/mobilePresence');
  const identify = currentIdentify();
  setTimeout(async () => {
    try {
      const guild = client.guilds.cache.first();
      const me = guild ? await guild.members.fetch({ user: client.user.id, withPresences: true, force: true }).catch(() => null) : null;
      const seen = me?.presence?.clientStatus ?? null;
      logger.info(`Gateway identify: ${identify.browser} / ${identify.os}. Discord sees the bot as: ${seen ? JSON.stringify(seen) : 'unknown (no presence data)'}.`);
    } catch (err) {
      logger.warn('Could not read how Discord sees the bot:', err.message);
    }
  }, 20_000).unref?.();
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    client.user.setPresence({
      status: config.presenceStatus,
      activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: 'Keeping the server safe', emoji: { name: '🦆' } }],
    });

    if (config.mobileStatus) reportMobileStatus(client);

    logger.info(`Petto v${require("../../package.json").version} is online as ${client.user.tag}, serving ${client.guilds.cache.size} guild(s).`);
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
