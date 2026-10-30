// Keeps the saved copy of every server (name, icon, members, channels, roles, emojis) fresh, so the dashboard reads it from the
// database instead of asking Discord on every page. Changes are saved a few seconds after they happen, and a full pass
// every 10 minutes catches member counts and anything an event missed.
const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const { scheduleGuildSnapshot, removeGuildSnapshot, announceGuildChange, syncAllGuildSnapshots } = require('../utils/guildSnapshots');

const INTERVAL_MS = 10 * 60_000;

function startGuildSnapshotJob(client) {
  const guildOf = (value) => value?.guild ?? null;
  for (const event of [Events.ChannelCreate, Events.ChannelDelete]) {
    client.on(event, (item) => scheduleGuildSnapshot(guildOf(item)));
  }
  // A role that changes or goes away can change what the bot may do in every channel: the bot's own roles are read from Discord again with the save.
  for (const event of [Events.RoleCreate, Events.RoleDelete]) {
    client.on(event, (item) => scheduleGuildSnapshot(guildOf(item), { refreshMe: true }));
  }
  client.on(Events.RoleUpdate, (_before, after) => scheduleGuildSnapshot(guildOf(after), { refreshMe: true }));
  for (const event of [Events.ChannelUpdate, Events.GuildEmojiUpdate]) {
    client.on(event, (_before, after) => scheduleGuildSnapshot(guildOf(after)));
  }
  for (const event of [Events.GuildEmojiCreate, Events.GuildEmojiDelete]) {
    client.on(event, (emoji) => scheduleGuildSnapshot(guildOf(emoji)));
  }
  // How the bot looks in a server (its nickname and server avatar) is part of the copy, and so are its roles (they decide where it may post).
  client.on(Events.GuildMemberUpdate, (_before, member) => {
    if (member?.id && member.id === client.user?.id) scheduleGuildSnapshot(member.guild, { refreshMe: true });
  });
  client.on(Events.GuildCreate, (guild) => {
    scheduleGuildSnapshot(guild);
    announceGuildChange(guild.id).catch(() => {});
  });
  client.on(Events.GuildUpdate, (_before, guild) => scheduleGuildSnapshot(guild));
  client.on(Events.GuildDelete, (guild) => {
    // The same event fires when Discord has an outage for that server, and then the bot is still in it.
    if (guild.available === false) return;
    removeGuildSnapshot(guild.id).catch((error) => logger.error(`[snapshots] removing ${guild.id} failed:`, error));
    announceGuildChange(guild.id).catch(() => {});
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
