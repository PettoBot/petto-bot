// Node 18 has Web Crypto only under require; Petto Code takes its random numbers from globalThis.crypto (it is read once, at startup, before any module runs).
// The line below is the whole fix: without it a bot on Node 18 starts, but every random function of Petto Code fails.
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;

const { Client, GatewayIntentBits, Options, Partials } = require('discord.js');
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
const { startRoleQuotaJob } = require('./src/jobs/roleQuotaJob');
const { startActivityLeaderboardJob } = require('./src/jobs/activityLeaderboardJob');
const { startAgedRolesJob } = require('./src/jobs/agedRolesJob');
const { startStreakJob } = require('./src/jobs/streakJob');
const { startMessageRolesJob } = require('./src/jobs/messageRolesJob');
const { startStayVoiceJob } = require('./src/jobs/stayVoiceJob');
const { startStatusHeartbeatJob } = require('./src/jobs/statusHeartbeatJob');
const { startStatusProbeJob } = require('./src/jobs/statusProbeJob');
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
const { startPremiumCleanupJob } = require('./src/jobs/premiumCleanupJob');
const { startPremiumLogJob } = require('./src/jobs/premiumLogJob');
const { startPremiumWatchJob } = require('./src/jobs/premiumWatchJob');
const { startQuestAlertsJob } = require('./src/jobs/questAlertsJob');
const { startRolloutAlertsJob } = require('./src/jobs/rolloutAlertsJob');
const { startRequestTimeoutJob } = require('./src/jobs/requestTimeoutJob');
const { startGlobalStatsJob } = require('./src/jobs/globalStatsJob');
const { startStatsCategoryJob } = require('./src/jobs/statsCategoryJob');
const { startGuildSnapshotJob } = require('./src/jobs/guildSnapshotJob');
const { startCommandDataJob } = require('./src/jobs/commandDataJob');
const { startCodeScheduleJob } = require('./src/jobs/codeScheduleJob');
const { startFormCleanupJob } = require('./src/jobs/formCleanupJob');
const { startJoinGateJob } = require('./src/jobs/joinGateJob');
const { startForumJob } = require('./src/jobs/forumJob');
const { startVerifyChecksJob } = require('./src/jobs/verifyChecksJob');
const { startAfkMentionsJob } = require('./src/jobs/afkMentionsJob');
const { startFeedsJob } = require('./src/jobs/feedsJob');
const music = require('./src/music/node');
const { startGuildPurgeJob } = require('./src/jobs/guildPurgeJob');
const { startServer } = require('./src/web/server');
const { startCloudflareTunnel } = require('./src/web/cloudflareTunnel');
const { attachRestRateLimitTelemetry } = require('./src/utils/restTelemetry');
const { createDiscordErrorLogSink } = require('./src/utils/discordErrorLog');
const { createPriorityErrorSink } = require('./src/utils/priorityErrorLog');
const { createErrorRouter } = require('./src/utils/errorRouting');
const { createGuildDiagnosticSink } = require('./src/utils/guildOpsAlerts');
const { flushActivity } = require('./src/db/activityStats');
const logger = require('./src/utils/logger');
const perf = require('./src/utils/perf');
const loadGuard = require('./src/utils/loadGuard');
const watchdog = require('./src/utils/watchdog');
const processGuards = require('./src/utils/processGuards');
const messageInterest = require('./src/utils/messageInterest');
const instanceRole = require('./src/utils/instanceRole');
// Whether this instance starts a background job: a worker leaves some to the primary (src/utils/instanceRole.ts).
function runsJob(name) {
  if (instanceRole.shouldRun(name)) return true;
  logger.info(`Job ${name}: left to the primary instance.`); // i18n-ignore: operator log
  return false;
}

// Every interval job of Petto is measured from here on (runs, time, queries and requests of each tick, utils/perf.js) and paused by the load guard when the bot is under pressure.
perf.trackIntervals();

// Answers fall back to a normal message when quoting is not possible (no Read Message History, or the message is gone).
require('./src/utils/safeReply').installSafeReply(require('discord.js').Message);
// A text display never throws for its length: too long it is cut, empty it holds a zero width space (see utils/cardBlocks.js).
require('./src/utils/cardBlocks').installTextDisplayGuard();

// Before the client exists: the phone icon next to the status dot (PETTO_MOBILE_STATUS=false turns it off, and `!botstatus device` saves the choice).
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
  // The memory of the bot: only 100 messages are kept for each channel (the default is 200). They are swept every two minutes: after an hour in the servers that have the log of
  // messages (it is the one that reads an old message) and after ten minutes in the others (utils/messageInterest.js; `!snipe` and the rest keep their own small stores). The members, the users and the presences stay: the counters, the identity and the commands read them.
  makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 100 }),
  sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: messageInterest.SWEEP_EVERY_SECONDS, filter: messageInterest.sweepFilter() } },
  // The limit of requests per second is the gate of utils/sharedRestLimit.js (two lanes: the answers to people first, the background work paced and bounded). discord.js
  // keeps its own limit only as a net, higher than the gate, so it never holds an answer behind the background work.
  // A request that Discord would hold for more than 15 seconds (a channel renamed more than twice in ten minutes) fails at once instead of sitting in the queue for minutes.
  rest: { globalRequestsPerSecond: Math.min(50, config.restRequestsPerSecond * 4), rejectOnRateLimit: (data) => Number(data?.timeToReset) > 15_000 },
  // Case cards/logs render `@user` mentions as text/reference, not as pings 
  // this is the default for every message the bot sends unless a specific
  // send call opts back in with its own `allowedMentions` (timers and `!send` do, so what their text mentions pings).
  allowedMentions: { parse: [] },
});

// Several independent listeners legitimately hang off the same event (guildMemberAdd alone has
// join logging, invite tracking, welcome messages, join roles, level join-bonus, the join gate, etc.) — that's
// normal fan-out, not a leak, so raise the default cap instead of Node warning on every restart.
client.setMaxListeners(30);
// The first row of every server is made with the language Petto detects for it, whichever part of Petto needs the row first.
require('./src/db/guilds').setGuildLookup((guildId) => client.guilds.cache.get(guildId));
attachRestRateLimitTelemetry(client);
// A `!` right before a mention (`!@everyone`, `!<@&id>`, `!@Role`) makes it show without notifying: done once, where every send meets.
require('./src/utils/silentMentionsHook').installSilentMentions(client);
// Every direct message that Petto starts says who it is from and carries the three small buttons (about it, delete it, report it): see utils/dmOrigin.js.
require('./src/utils/dmOrigin').installDmOrigin();
require('./src/utils/redis').start();
// The dashboard says on Redis when it changes a setting, so the caches forget it at once instead of when they expire.
require('./src/utils/cacheInvalidation').startCacheInvalidation();
require('./src/utils/sharedRestLimit').attachSharedRestLimit(client.rest, config.restRequestsPerSecond);
// The general log (warnings, rate limits, Redis and the errors Petto expects) and the priority log (the errors to investigate, which ping the team).
logger.setDiscordSink(createErrorRouter({
  general: createDiscordErrorLogSink(client, config.errorLogChannelId),
  priority: createPriorityErrorSink(client, {
    channelId: config.opsChannels.priorityErrors,
    fallbackChannelId: config.errorLogChannelId,
    pingUserIds: config.priorityPing.userIds,
    pingRoleId: config.priorityPing.roleId,
  }),
}));
logger.addDiscordSink(createGuildDiagnosticSink(client));

// The process stays up for a failed request (Discord, the network, the database, a timeout) and stops cleanly for anything else (utils/processGuards.js).
processGuards.installProcessGuards({ exit: (reason) => shutdown(reason, 1), canExit: () => watchdog.stats().restartsLastHour < config.watchdogMaxRestartsPerHour, client });
processGuards.installGatewayGuards(client, { exit: (reason) => shutdown(reason, 1) });
// When memory is the problem the caches that can be filled again are emptied before anything is restarted.
loadGuard.setDropCaches(() => {
  let dropped = 0;
  try { dropped += client.sweepers.sweepMessages(() => true); } catch { /* the sweepers may be off */ }
  try { dropped += client.sweepers.sweepPresences(() => true); } catch { /* the sweepers may be off */ }
  try { global.gc?.(); } catch { /* not exposed */ }
  return dropped;
});

let shuttingDown = false;
async function shutdown(signal, code = 0) {
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
  require('./src/utils/linkRuntime').stopAll();
  client.destroy();
  // The connections to the database are closed before the process stops (a restart for a new device comes through here too).
  await Promise.race([
    Promise.resolve(require('./src/db/postgres').closePools()).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  process.exit(code);
}

process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
process.once('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)); });

async function main() {
  loadCommands(client);
  loadEvents(client);
  music.init(client); // before the login: the connection to the node waits for the client to be ready by itself

  logger.info(`Instance: ${instanceRole.describe()}.`); // i18n-ignore: operator log
  await runMigrations();
  // A worker asks the primary which other databases (the Vault, the code database) it can reach through the bridge.
  await require('./src/db/bridgeTargets').load();
  // Which servers have the log of messages on: the others do not keep their messages for an hour in memory (utils/messageInterest.js).
  messageInterest.start();
  // The blacklist of servers is read into memory before the login, so the first guildCreate and the first message already know it (and every few minutes after).
  await require('./src/db/guildBlacklist').load().catch((err) => logger.warn('Could not read the server blacklist (the environment list still applies):', err.message));
  require('./src/db/guildBlacklist').startRefresh();
  // The device saved with `!botstatus device` wins over PETTO_MOBILE_STATUS. The gateway reads the names when it connects (the login
  // below), so the database being ready here is early enough; if it cannot be read the environment keeps deciding and the boot goes on.
  await require('./src/utils/botDevice').applySavedDevice().catch((err) => logger.warn('Could not apply the saved device of the bot:', err.message));
  // The slash commands are registered once for the whole bot, by the primary.
  if (!instanceRole.isWorker()) await deployCommands();
  await client.login(config.token);
  if (runsJob('startExpiryJob')) startExpiryJob(client);
  if (runsJob('startBumpReminderJob')) startBumpReminderJob(client);
  if (runsJob('startVoiceXpJob')) startVoiceXpJob(client);
  if (runsJob('startActivityStatsJob')) startActivityStatsJob(client);
  if (runsJob('startGiveawayJob')) startGiveawayJob(client);
  if (runsJob('startReminderJob')) startReminderJob(client);
  if (runsJob('startAutoMessageJob')) startAutoMessageJob(client);
  if (runsJob('startBirthdayJob')) startBirthdayJob(client);
  if (runsJob('startCountingRoleJob')) startCountingRoleJob(client);
  if (runsJob('startRoleQuotaJob')) startRoleQuotaJob(client);
  if (runsJob('startActivityLeaderboardJob')) startActivityLeaderboardJob(client);
  if (runsJob('startAgedRolesJob')) startAgedRolesJob(client);
  if (runsJob('startStreakJob')) startStreakJob(client);
  if (runsJob('startMessageRolesJob')) startMessageRolesJob(client);
  if (runsJob('startStayVoiceJob')) startStayVoiceJob(client);
  if (runsJob('startVerifyPanelJob')) startVerifyPanelJob(client);
  if (runsJob('startStatusHeartbeatJob')) startStatusHeartbeatJob(client);
  if (runsJob('startStatusProbeJob')) startStatusProbeJob(client);
  if (runsJob('startBulkRoleJob')) startBulkRoleJob(client);
  if (runsJob('startTicketAutocloseJob')) startTicketAutocloseJob(client);
  if (runsJob('startTicketReminderJob')) startTicketReminderJob(client);
  if (runsJob('startAntiScamJob')) startAntiScamJob();
  if (runsJob('startLockdownJob')) startLockdownJob(client);
  if (runsJob('startAppealCleanupJob')) startAppealCleanupJob(client);
  if (runsJob('startTicketAutoDeleteJob')) startTicketAutoDeleteJob(client);
  if (runsJob('startTicketChannelJob')) startTicketChannelJob(client);
  if (runsJob('startPollAutocloseJob')) startPollAutocloseJob(client);
  if (runsJob('startCounterJob')) startCounterJob(client);
  if (runsJob('startBackupVaultJob')) startBackupVaultJob(client);
  if (runsJob('startPremiumRoleJob')) startPremiumRoleJob(client);
  if (runsJob('startPremiumCleanupJob')) startPremiumCleanupJob(client);
  if (runsJob('startPremiumLogJob')) startPremiumLogJob(client);
  if (runsJob('startPremiumWatchJob')) startPremiumWatchJob(client);
  if (runsJob('startQuestAlertsJob')) startQuestAlertsJob(client);
  if (runsJob('startRolloutAlertsJob')) startRolloutAlertsJob(client);
  if (runsJob('startRequestTimeoutJob')) startRequestTimeoutJob(client);
  if (runsJob('startGlobalStatsJob')) startGlobalStatsJob(client);
  if (runsJob('startStatsCategoryJob')) startStatsCategoryJob(client);
  if (runsJob('startGuildSnapshotJob')) startGuildSnapshotJob(client);
  if (runsJob('startCommandDataJob')) startCommandDataJob();
  if (runsJob('startCodeScheduleJob')) startCodeScheduleJob(client);
  if (runsJob('startFormCleanupJob')) startFormCleanupJob();
  if (runsJob('startJoinGateJob')) startJoinGateJob(client);
  if (runsJob('startForumJob')) startForumJob(client);
  if (runsJob('startVerifyChecksJob')) startVerifyChecksJob();
  if (runsJob('startAfkMentionsJob')) startAfkMentionsJob();
  if (runsJob('startFeedsJob')) startFeedsJob(client);
  if (runsJob('startGuildPurgeJob')) startGuildPurgeJob(client);
  // The web API (and the SQL bridge in it) and the tunnel belong to the instance that has the database; a worker has neither.
  if (!instanceRole.isWorker()) {
    startServer(client);
    startCloudflareTunnel(config.cloudflareTunnelToken);
  } else {
    // A worker serves the same routes only on 127.0.0.1 and keeps a WebSocket open to the primary, which sends it the dashboard requests for the servers of its shards.
    const app = startServer(client);
    const server = app?.locals?.httpServer;
    if (!server || !config.dbBridgeUrl || !config.dbBridgeSecret) {
      logger.warn('Link: this worker has no web routes or no bridge settings (PETTO_DASHBOARD_API_SECRET, PETTO_DB_BRIDGE_URL, PETTO_BRIDGE_SECRET): the dashboard cannot reach the servers of its shards.'); // i18n-ignore: operator log
    } else {
      server.once('listening', () => {
        require('./src/utils/linkRuntime').startWorkerLink({
          bridgeUrl: config.dbBridgeUrl, secret: config.dbBridgeSecret, port: server.address().port, worker: process.env.PETTO_WORKER_ID || require('node:os').hostname(),
          // What the dashboard said on Redis reaches this worker (it has none) through the link: its caches forget it, and so does what the bridge remembered.
          onEvent: ({ channel, message }) => { require('./src/db/postgres').clearBridgeCaches(); require('./src/utils/redis').deliverLocal(channel, message); },
        });
      });
      if (server.listening) server.emit('listening');
    }
  }
  // The measurements (the loop, the CPU, the memory), the circuit breaker and the watchdog start last, once everything else is running.
  perf.startSampler();
  loadGuard.start();
  watchdog.start({ exit: (reason) => shutdown(reason, 1) }).catch((err) => logger.warn('The watchdog could not start:', err.message));
}

main().catch(async (err) => {
  logger.error('Fatal error during startup:', err);
  // The host starts the bot again as soon as it stops. A pause first keeps a start that always fails from asking Discord
  // and the database again every few seconds, which is how a rate limit turns into a restart loop.
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  process.exit(1);
});
