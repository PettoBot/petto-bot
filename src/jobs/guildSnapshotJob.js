// Keeps the saved copy of every server (name, icon, members, channels, roles) fresh, so the dashboard reads it from the
// database instead of asking Discord on every page. Changes are saved a few seconds after they happen, and a full pass
// every 10 minutes catches member counts and anything an event missed.
const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const { scheduleGuildSnapshot, removeGuildSnapshot, syncAllGuildSnapshots } = require('../utils/guildSnapshots');

const INTERVAL_MS = 10 * 60_000;

function startGuildSnapshotJob(client) {
  const guildOf = (value) => value?.guild ?? null;
  for (const event of [Events.ChannelCreate, Events.ChannelDelete, Events.RoleCreate, Events.RoleDelete]) {
    client.on(event, (item) => scheduleGuildSnapshot(guildOf(item)));
  }
  for (const event of [Events.ChannelUpdate, Events.RoleUpdate]) {
    client.on(event, (_before, after) => scheduleGuildSnapshot(guildOf(after)));
  }
  client.on(Events.GuildCreate, (guild) => scheduleGuildSnapshot(guild));
  client.on(Events.GuildUpdate, (_before, guild) => scheduleGuildSnapshot(guild));
  client.on(Events.GuildDelete, (guild) => {
    // The same event fires when Discord has an outage for that server, and then the bot is still in it.
    if (guild.available === false) return;
    removeGuildSnapshot(guild.id).catch((error) => logger.error(`[snapshots] removing ${guild.id} failed:`, error));
  });

  const run = exclusiveTask(() => syncAllGuildSnapshots(client));
  const tick = () => run()
    .then((result) => { if (result.saved || result.removed) logger.info(`[snapshots] saved ${result.saved}, removed ${result.removed} of ${result.total} servers.`); })
    .catch((error) => logger.error('[snapshots] sync failed:', error));
  setTimeout(tick, 10_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
  logger.info('Guild snapshot job started (changes after 3s, full pass every 10 min).');
}

module.exports = { startGuildSnapshotJob };
