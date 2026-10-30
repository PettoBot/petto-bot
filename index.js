// Node 18 has Web Crypto only under require; Petto Code takes its random numbers from globalThis.crypto (it is read once, at startup).
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./src/config');
const { loadCommands } = require('./src/handlers/commandHandler');
const { loadEvents } = require('./src/handlers/eventHandler');
const { deployCommands } = require('./src/handlers/deployCommands');
const { runMigrations } = require('./src/db/migrate');
const { startExpiryJob } = require('./src/jobs/expireSanctions');
const { startBumpReminderJob } = require('./src/jobs/bumpReminderJob');
const { startVoiceXpJob } = require('./src/jobs/voiceXpJob');
const { startActivityStatsJob } = require('./src/jobs/activityStatsJob');
const { startGiveawayJob } = require('./src/jobs/giveawayJob');
const { startReminderJob } = require('./src/jobs/reminderJob');
const { startAutoMessageJob } = require('./src/jobs/autoMessageJob');
const { startVerifyPanelJob } = require('./src/jobs/verifyPanelJob');
const { startBirthdayJob } = require('./src/jobs/birthdayJob');
const { startCountingRoleJob } = require('./src/jobs/countingRoleJob');
const { startStatusHeartbeatJob } = require('./src/jobs/statusHeartbeatJob');
const { startBulkRoleJob } = require('./src/jobs/bulkRoleJob');
const { startTicketAutocloseJob } = require('./src/jobs/ticketAutocloseJob');
const { startTicketReminderJob } = require('./src/jobs/ticketReminderJob');
const { startAntiScamJob } = require('./src/jobs/antiScamJob');
const { startLockdownJob } = require('./src/jobs/lockdownJob');
const { startAppealCleanupJob } = require('./src/jobs/appealCleanupJob');
const { startTicketAutoDeleteJob } = require('./src/jobs/ticketAutoDeleteJob');
const { startTicketChannelJob } = require('./src/jobs/ticketChannelJob');
const { startPollAutocloseJob } = require('./src/jobs/pollAutocloseJob');
const { startCounterJob } = require('./src/jobs/counterJob');
const { startBackupVaultJob } = require('./src/jobs/backupVaultJob');
const { startPremiumRoleJob } = require('./src/jobs/premiumRoleJob');
const { startPremiumLogJob } = require('./src/jobs/premiumLogJob');
const { startMaliciousFeedJob } = require('./src/jobs/maliciousFeedJob');
const { startQuestAlertsJob } = require('./src/jobs/questAlertsJob');
const { startRolloutAlertsJob } = require('./src/jobs/rolloutAlertsJob');
const { startRequestTimeoutJob } = require('./src/jobs/requestTimeoutJob');
const { startGlobalStatsJob } = require('./src/jobs/globalStatsJob');
const { startGuildSnapshotJob } = require('./src/jobs/guildSnapshotJob');
const { startCommandDataJob } = require('./src/jobs/commandDataJob');
const { startFormCleanupJob } = require('./src/jobs/formCleanupJob');
const { startAfkMentionsJob } = require('./src/jobs/afkMentionsJob');
const { startFeedsJob } = require('./src/jobs/feedsJob');
const music = require('./src/music/node');
const { startGuildPurgeJob } = require('./src/jobs/guildPurgeJob');
const { startAvatarPackJob } = require('./src/jobs/avatarPackJob');
const { startDataMoveJob } = require('./src/jobs/dataMoveJob');
const { startProfileHistoryBackfillJob } = require('./src/jobs/profileHistoryBackfillJob');
const { startServer } = require('./src/web/server');
const { startCloudflareTunnel } = require('./src/web/cloudflareTunnel');
const { attachRestRateLimitTelemetry } = require('./src/utils/restTelemetry');
const { createDiscordErrorLogSink } = require('./src/utils/discordErrorLog');
const { createGuildDiagnosticSink } = require('./src/utils/guildOpsAlerts');
const { attachGuildComplianceMonitor } = require('./src/utils/guildComplianceDetector');
const { flushActivity } = require('./src/db/activityStats');
const logger = require('./src/utils/logger');

// Answers fall back to a normal message when quoting is not possible (no Read Message History, or the message is gone).
require('./src/utils/safeReply').installSafeReply(require('discord.js').Message);

// Before the client exists: the phone icon next to the status dot (PETTO_MOBILE_STATUS=false turns it off).
if (config.mobileStatus) require('./src/utils/mobilePresence').applyMobileIdentify();

const client = new Client({
  ...(config.shards ? { shards: config.shards } : {}),
  ...(config.shardCount && config.shards !== 'auto' ? { shardCount: config.shardCount } : {}),
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration, // ban/unban logs
    GatewayIntentBits.GuildInvites, // invite create/delete logs
    GatewayIntentBits.GuildVoiceStates, // voice connect/disconnect/mute logs
    GatewayIntentBits.GuildExpressions, // emoji create/delete/update logs
    GatewayIntentBits.GuildWebhooks, // webhook creation tracking (anti-nuke) and webhook logs
    GatewayIntentBits.GuildScheduledEvents, // scheduled event logs
    GatewayIntentBits.AutoModerationConfiguration, // AutoMod rule logs
    GatewayIntentBits.GuildMessageReactions, // reaction-mode giveaway entries
    GatewayIntentBits.GuildMessagePolls, // poll vote logs
    // Privileged — must also be toggled on for this bot application in the Discord Developer
    // Portal (Bot page -> Privileged Gateway Intents -> Presence Intent), or every member's
    // `.presence` stays null and /spotify + /activity can never see what anyone is doing.
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Message, Partials.Reaction],
  // One limit for every request the bot makes, so a burst (a restart, a sync, a busy minute) waits in line instead of passing the host's cap.
  rest: { globalRequestsPerSecond: config.restRequestsPerSecond },
  // Case cards/logs render `@user` mentions as text/reference, not as pings 
  // this is the default for every message the bot sends unless a specific
  // send call opts back in with its own `allowedMentions`.
  allowedMentions: { parse: [] },
});

// Several independent listeners legitimately hang off the same event (guildMemberAdd alone has
// join logging, invite tracking, welcome messages, join roles, level join-bonus, etc.) — that's
// normal fan-out, not a leak, so raise the default cap instead of Node warning on every restart.
client.setMaxListeners(30);
// The first row of every server is made with the language Petto detects for it, whichever part of Petto needs the row first.
require('./src/db/guilds').setGuildLookup((guildId) => client.guilds.cache.get(guildId));
attachRestRateLimitTelemetry(client);
// A `!` right before a mention (`!@everyone`, `!<@&id>`, `!@Role`) makes it show without notifying: done once, where every send meets.
require('./src/utils/silentMentionsHook').installSilentMentions(client);
require('./src/utils/redis').start();
// The dashboard says on Redis when it changes a setting, so the caches forget it at once instead of when they expire.
require('./src/utils/cacheInvalidation').startCacheInvalidation();
require('./src/utils/sharedRestLimit').attachSharedRestLimit(client.rest, config.restRequestsPerSecond);
logger.setDiscordSink(createDiscordErrorLogSink(client, config.errorLogChannelId));
logger.addDiscordSink(createGuildDiagnosticSink(client));
attachGuildComplianceMonitor(client);

process.on('unhandledRejection', (err) => (require('./src/utils/permissionErrors').isPermissionError(err)
  ? logger.warn(`Missing permission (unhandled): ${err.message} (code ${err.code})`)
  : logger.error('Unhandled promise rejection:', err)));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}; flushing buffered activity before shutdown.`);
  await Promise.race([
    flushActivity().catch((err) => logger.error('Activity flush during shutdown failed:', err)),
    new Promise((resolve) => setTimeout(() => {
      logger.warn('Activity flush did not finish before shutdown timeout; continuing to close the client.');
      resolve();
    }, 10_000)),
  ]);
  // Omniplex shows the status Petto posts last: it says offline now, at most a few seconds.
  await Promise.race([
    require('./src/jobs/omniplexStatsJob').postOffline(client),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  client.destroy();
  process.exit(0);
}

process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
process.once('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)); });

async function main() {
  loadCommands(client);
  loadEvents(client);
  music.init(client); // before the login: the connection to the node waits for the client to be ready by itself

  await runMigrations();
  await deployCommands();
  await client.login(config.token);
  startExpiryJob(client);
  startBumpReminderJob(client);
  startVoiceXpJob(client);
  startActivityStatsJob(client);
  startGiveawayJob(client);
  startReminderJob(client);
  startAutoMessageJob(client);
  startBirthdayJob(client);
  startCountingRoleJob(client);
  startVerifyPanelJob(client);
  startStatusHeartbeatJob(client);
  startBulkRoleJob(client);
  startTicketAutocloseJob(client);
  startTicketReminderJob(client);
  startAntiScamJob();
  startLockdownJob(client);
  startAppealCleanupJob(client);
  startTicketAutoDeleteJob(client);
  startTicketChannelJob(client);
  startPollAutocloseJob(client);
  startCounterJob(client);
  startBackupVaultJob(client);
  startPremiumRoleJob(client);
  startPremiumLogJob(client);
  startMaliciousFeedJob();
  startQuestAlertsJob(client);
  startRolloutAlertsJob(client);
  startRequestTimeoutJob(client);
  startGlobalStatsJob(client);
  startGuildSnapshotJob(client);
  startCommandDataJob();
  startFormCleanupJob();
  startAfkMentionsJob();
  startFeedsJob(client);
  startGuildPurgeJob(client);
  startAvatarPackJob();
  startDataMoveJob();
  startProfileHistoryBackfillJob();
  startServer(client);
  startCloudflareTunnel(config.cloudflareTunnelToken);
}

main().catch(async (err) => {
  logger.error('Fatal error during startup:', err);
  // The host starts the bot again as soon as it stops. A pause first keeps a start that always fails from asking Discord
  // and the database again every few seconds, which is how a rate limit turns into a restart loop.
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  process.exit(1);
});
