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
const { startStatusHeartbeatJob } = require('./src/jobs/statusHeartbeatJob');
const { startBulkRoleJob } = require('./src/jobs/bulkRoleJob');
const { startTicketAutocloseJob } = require('./src/jobs/ticketAutocloseJob');
const { startPollAutocloseJob } = require('./src/jobs/pollAutocloseJob');
const { startCounterJob } = require('./src/jobs/counterJob');
const { startBackupVaultJob } = require('./src/jobs/backupVaultJob');
const { startPremiumRoleJob } = require('./src/jobs/premiumRoleJob');
const { startServer } = require('./src/web/server');
const { startCloudflareTunnel } = require('./src/web/cloudflareTunnel');
const { attachRestRateLimitTelemetry } = require('./src/utils/restTelemetry');
const { createDiscordErrorLogSink } = require('./src/utils/discordErrorLog');
const logger = require('./src/utils/logger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration, // ban/unban logs
    GatewayIntentBits.GuildInvites, // invite create/delete logs
    GatewayIntentBits.GuildVoiceStates, // voice connect/disconnect/mute logs
    GatewayIntentBits.GuildExpressions, // emoji create/delete/update logs
    GatewayIntentBits.GuildWebhooks, // webhook creation tracking (anti-nuke)
    GatewayIntentBits.GuildMessageReactions, // reaction-mode giveaway entries
    // Privileged — must also be toggled on for this bot application in the Discord Developer
    // Portal (Bot page -> Privileged Gateway Intents -> Presence Intent), or every member's
    // `.presence` stays null and /spotify + /activity can never see what anyone is doing.
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Message, Partials.Reaction],
  // Case cards/logs render `@user` mentions as text/reference, not as pings 
  // this is the default for every message the bot sends unless a specific
  // send call opts back in with its own `allowedMentions`.
  allowedMentions: { parse: [] },
});

// Several independent listeners legitimately hang off the same event (guildMemberAdd alone has
// join logging, invite tracking, welcome messages, join roles, level join-bonus, etc.) — that's
// normal fan-out, not a leak, so raise the default cap instead of Node warning on every restart.
client.setMaxListeners(30);
attachRestRateLimitTelemetry(client);
logger.setDiscordSink(createDiscordErrorLogSink(client, config.errorLogChannelId));

process.on('unhandledRejection', (err) => logger.error('Unhandled promise rejection:', err));

async function main() {
  loadCommands(client);
  loadEvents(client);

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
  startStatusHeartbeatJob(client);
  startBulkRoleJob(client);
  startTicketAutocloseJob(client);
  startPollAutocloseJob(client);
  startCounterJob(client);
  startBackupVaultJob(client);
  startPremiumRoleJob(client);
  startServer(client);
  startCloudflareTunnel(config.cloudflareTunnelToken);
}

main().catch((err) => {
  logger.error('Fatal error during startup:', err);
  process.exit(1);
});
