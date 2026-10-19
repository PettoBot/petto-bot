// i18n-ignore-file: log lines for the team of Petto (the host console and the log channel of Discord), not messages for the members.
const { REST, Routes } = require('discord.js');
const config = require('../config');
const { collectCommandData, collectPrivateGuildCommandData } = require('./commandHandler');
const crypto = require('node:crypto');
const logger = require('../utils/logger');

// What the last registration did, kept to be said in the log of Discord once the bot is connected (the registration runs before the
// login, when that log does not exist yet, so until now it only reached the host's console).
let lastReport = null;
const namesOf = (list) => (Array.isArray(list) ? list : []).map((command) => command?.name).filter(Boolean);
/** Discord's refusal in a few words: the status, the message and which field it did not accept. */
function describeError(error) {
  const wait = error?.retryAfter ?? error?.rawError?.retry_after;
  let detail = '';
  try { if (error?.rawError?.errors) detail = ` ${JSON.stringify(error.rawError.errors).slice(0, 500)}`; } catch { /* no detail */ }
  return `${error?.status ?? ''} ${error?.message ?? error}${detail}${wait ? `, Discord asks to wait ${wait}s` : ''}`.trim();
}

const hashOf = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The hash of what was last registered is kept in the database. Registering ~300 commands on every start is a bulk
// overwrite that Discord limits, and a restart loop (the host restarts the bot when it stops) hits that limit again and again.
const defaultSettings = () => require('../db/botSettings');
async function lastDeployed(settings, key) {
  try { return await settings.getSetting(key); } catch { return null; }
}
async function rememberDeployed(settings, key, hash) {
  try { await settings.setSetting(key, hash); } catch { /* the next start just registers again */ }
}

const devGuildIdsOf = () => config.devGuildIds ?? (config.devGuildId ? [config.devGuildId] : []);
const sameNames = (live, body) => {
  const a = namesOf(live).sort(); const b = namesOf(body).sort();
  return a.length === b.length && a.every((name, i) => name === b[i]);
};
// Set once the guild-scoped copies of the commands were removed while the commands are global (see cleanupGuildCommands).
const CLEANUP_KEY = 'commands_cleanup:guild_scoped';

/** The private commands (a command with `privateGuildId`), grouped by the one server each belongs to. */
function privateCommandsByGuild() {
  const byGuild = new Map();
  for (const registration of collectPrivateGuildCommandData()) {
    const list = byGuild.get(registration.guildId) ?? [];
    list.push(registration.data);
    byGuild.set(registration.guildId, list);
  }
  return byGuild;
}

/**
 * Registers every command in src/commands/** with Discord (PUT replaces the whole set), but only when the commands
 * changed since the last time. A failure here (a rate limit, Discord being down) never stops the bot from starting: the
 * commands that were registered before keep working.
 *
 * One scope only: global, or, when DISCORD_DEV_GUILD_ID is set, only in those test servers. A command registered in both
 * scopes shows twice in Discord, so a server never receives the global commands as guild commands: a server with private
 * commands gets only its private commands (plus the whole set when it is a test server).
 */
async function deployCommands({ force = false, strict = false, rest = new REST({ globalRequestsPerSecond: config.restRequestsPerSecond ?? 8 }).setToken(config.token), settings = null } = {}) {
  const commands = collectCommandData();
  settings ??= defaultSettings();
  const privateByGuild = privateCommandsByGuild();

  // One target per test server when there are some (a list of ids works), or the global one.
  const devGuildIds = devGuildIdsOf();
  const targets = devGuildIds.length
    ? devGuildIds.map((guildId) => ({ guildId, route: Routes.applicationGuildCommands(config.clientId, guildId), key: `commands_hash:${guildId}`, body: [...commands, ...(privateByGuild.get(guildId) ?? [])], scope: 'dev' }))
    : [{ guildId: null, route: Routes.applicationCommands(config.clientId), key: 'commands_hash:global', body: commands, scope: 'global' }];
  // The servers with private commands that are not a test server: only their private commands, never a copy of the global ones.
  const privateTargets = [...privateByGuild].filter(([guildId]) => !devGuildIds.includes(guildId))
    .map(([guildId, list]) => ({ guildId, route: Routes.applicationGuildCommands(config.clientId, guildId), key: `private_commands_hash:${guildId}`, body: list, scope: 'private', private: true }));

  let result = null;
  const report = { at: Date.now(), scope: devGuildIds.length ? 'dev' : 'global', targets: [] };
  lastReport = report;
  for (const target of [...targets, ...privateTargets]) {
    // The application and the scope are part of the hash: another bot on the same database, or a switch between the global and the
    // test-server registration, always registers again.
    const hash = hashOf({ app: config.clientId, scope: target.scope, commands: target.body });
    const entry = { guildId: target.guildId, private: Boolean(target.private), status: 'unchanged', total: target.body.length, created: [], removed: [], error: null };
    if (!target.private) report.targets.push(entry);
    // What Discord has now: it says what is new and what is gone, and checks that a matching hash really means nothing to send.
    let before = null;
    if (!force && await lastDeployed(settings, target.key) === hash) {
      let live = null;
      try { live = await rest.get(target.route); } catch { /* cannot check: trust the hash */ }
      if (!Array.isArray(live) || sameNames(live, target.body)) {
        if (!target.private) logger.info(`The ${target.body.length} command(s) did not change since the last start: not registering them again${target.guildId ? ` in ${target.guildId}` : ''}.`);
        continue;
      }
      logger.warn(`The saved hash says the commands${target.guildId ? ` of ${target.guildId}` : ''} are registered, but Discord has ${live.length} instead of ${target.body.length} with the same names: registering them again.`);
      before = namesOf(live);
    }
    if (!before) {
      try { before = namesOf(await rest.get(target.route)); } catch { /* the report then just says how many */ }
    }
    try {
      const registered = await rest.put(target.route, { body: target.body });
      if (!target.private) result = registered;
      await rememberDeployed(settings, target.key, hash);
      entry.status = 'registered';
      if (before) {
        const now = namesOf(target.body);
        entry.created = now.filter((name) => !before.includes(name));
        entry.removed = before.filter((name) => !now.includes(name));
      }
      logger.info(
        target.private
          ? `Registered ${target.body.length} private command(s) to guild ${target.guildId}${entry.removed.length ? ` (removed there: ${entry.removed.join(', ')})` : ''}.` // i18n-ignore: a log
          : target.guildId
            ? `Registered ${registered.length} command(s) to dev guild ${target.guildId}.` // i18n-ignore: a log
            : `Registered ${registered.length} command(s) globally (can take up to 1 hour to propagate).`, // i18n-ignore: a log
      );
    } catch (error) {
      entry.status = 'failed';
      entry.error = describeError(error);
      if (strict) throw error;
      const wait = error?.retryAfter ?? error?.rawError?.retry_after;
      logger.warn(`The ${target.private ? 'private ' : ''}commands could not be registered${target.guildId ? ` in ${target.guildId}` : ''} (${error?.status ?? ''} ${error?.message ?? error}${wait ? `, Discord asks to wait ${wait}s` : ''}). Starting anyway with the ones registered before; the next start tries again.`);
    }
  }

  if (devGuildIds.length) {
    // In test-server mode the global commands are not touched: when some exist, every command shows twice in the test servers.
    await rememberDeployed(settings, CLEANUP_KEY, ''); // going back to global cleans the test servers again
    try {
      const global = await rest.get(Routes.applicationCommands(config.clientId));
      if (Array.isArray(global) && global.length) {
        report.globalAlso = global.length;
        logger.warn(`DISCORD_DEV_GUILD_ID is set, so the commands are registered only in ${devGuildIds.join(', ')}, but ${global.length} global command(s) exist too: in those servers each command shows twice. Leave DISCORD_DEV_GUILD_ID empty in production.`);
      }
    } catch { /* nothing to say */ }
  }

  return result;
}

const pause = (ms) => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms); }) : Promise.resolve());

/**
 * Removes the guild-scoped copies of Petto's commands, left from a time the commands were registered per server (DISCORD_DEV_GUILD_ID
 * set): with the global ones they show twice. Only while the commands are global and their registration did not fail, once (a
 * bot_settings flag), one server at a time and in the background. Each server is read first and overwritten with an empty list only
 * when it has commands of Petto; the servers with private commands are left to deployCommands, which keeps only those there.
 */
async function cleanupGuildCommands(client, { rest = null, settings = null, delayMs = 300, force = false, guildIds: givenIds = null } = {}) {
  if (devGuildIdsOf().length) return null;
  const global = lastReport?.targets?.find((entry) => !entry.guildId);
  if (!force && (!global || global.status === 'failed')) return null;
  settings ??= defaultSettings();
  const marker = `done:${config.clientId}`;
  if (!force && await lastDeployed(settings, CLEANUP_KEY) === marker) return null;
  rest ??= new REST({ globalRequestsPerSecond: Math.max(1, Math.floor((config.restRequestsPerSecond ?? 8) / 2)) }).setToken(config.token);
  const privateGuilds = new Set(privateCommandsByGuild().keys());
  const guildIds = [...(givenIds ?? client?.guilds?.cache?.keys?.() ?? [])].map(String).filter((id) => !privateGuilds.has(id));
  const summary = { checked: 0, cleaned: [], failed: 0 };
  for (const guildId of guildIds) {
    const route = Routes.applicationGuildCommands(config.clientId, guildId);
    summary.checked += 1;
    let existing;
    try {
      existing = await rest.get(route);
    } catch (error) {
      // 403/404: Petto cannot have commands there (no access, or it left).
      if (![403, 404].includes(error?.status)) summary.failed += 1;
      await pause(delayMs);
      continue;
    }
    if (Array.isArray(existing) && existing.length) {
      try {
        await rest.put(route, { body: [] });
        summary.cleaned.push(`${guildId} (${existing.length})`);
        // A later test-server registration there must not be skipped by an old hash.
        await rememberDeployed(settings, `commands_hash:${guildId}`, '');
      } catch (error) {
        summary.failed += 1;
        logger.warn(`The old server commands of ${guildId} could not be removed: ${describeError(error)}`);
      }
    }
    await pause(delayMs);
  }
  if (!summary.failed) await rememberDeployed(settings, CLEANUP_KEY, marker);
  logger.info(`Old server-only copies of the slash commands: checked ${summary.checked} server(s), ${summary.cleaned.length ? `removed them in ${summary.cleaned.join(', ')}` : 'none had any'}${summary.failed ? `; ${summary.failed} could not be checked, the next start tries again` : ''}.`);
  return summary;
}

/**
 * Says in the log what the registration of this start did: the commands that were created, the ones that were removed, or why it failed.
 * Called when the bot is connected, so the line reaches the log of Discord and not only the console.
 */
function announceDeployReport(report = lastReport) {
  if (!report) return;
  for (const entry of report.targets) {
    const where = entry.guildId ? ` in the test server ${entry.guildId}` : '';
    if (entry.status === 'registered') {
      logger.info(`Slash commands registered${where}: ${entry.total} in total. ${entry.created.length ? `Created: ${entry.created.join(', ')}.` : 'None is new.'}${entry.removed.length ? ` Removed: ${entry.removed.join(', ')}.` : ''}${entry.created.length || entry.removed.length ? ' If they do not show, reload Discord.' : ''}`);
    } else if (entry.status === 'failed') {
      logger.warn(`Slash commands NOT registered${where}: ${entry.error}. The ones from before keep working, and the new ones will not show until this is fixed.`);
    } else {
      logger.info(`Slash commands unchanged${where}: the ${entry.total} that are registered already match, so nothing was sent.`);
    }
  }
  if (report.globalAlso) logger.warn(`DISCORD_DEV_GUILD_ID is set and ${report.globalAlso} global command(s) exist too, so in the test servers every command shows twice. Leave DISCORD_DEV_GUILD_ID empty in production and restart.`);
}

module.exports = { deployCommands, cleanupGuildCommands, announceDeployReport, getDeployReport: () => lastReport };
