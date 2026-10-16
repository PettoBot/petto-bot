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

/**
 * Registers every command in src/commands/** with Discord (PUT replaces the whole set), but only when the commands
 * changed since the last time. A failure here (a rate limit, Discord being down) never stops the bot from starting: the
 * commands that were registered before keep working.
 */
async function deployCommands({ force = false, strict = false, rest = new REST({ globalRequestsPerSecond: config.restRequestsPerSecond ?? 8 }).setToken(config.token), settings = null } = {}) {
  const commands = collectCommandData();
  settings ??= defaultSettings();

  // One target per test server when there are some (a list of ids works), or the global one.
  const devGuildIds = config.devGuildIds ?? (config.devGuildId ? [config.devGuildId] : []);
  const targets = devGuildIds.length
    ? devGuildIds.map((guildId) => ({ guildId, route: Routes.applicationGuildCommands(config.clientId, guildId), key: `commands_hash:${guildId}` }))
    : [{ guildId: null, route: Routes.applicationCommands(config.clientId), key: 'commands_hash:global' }];
  const hash = hashOf(commands);
  let result = null;
  const report = { at: Date.now(), targets: [] };
  lastReport = report;
  for (const target of targets) {
    const entry = { guildId: target.guildId, status: 'unchanged', total: commands.length, created: [], removed: [], error: null };
    report.targets.push(entry);
    if (!force && await lastDeployed(settings, target.key) === hash) {
      logger.info(`The ${commands.length} command(s) did not change since the last start: not registering them again${target.guildId ? ` in ${target.guildId}` : ''}.`);
      continue;
    }
    // What Discord has now, to say what is new and what is gone.
    let before = null;
    try { before = namesOf(await rest.get(target.route)); } catch { /* the report then just says how many */ }
    try {
      result = await rest.put(target.route, { body: commands });
      await rememberDeployed(settings, target.key, hash);
      entry.status = 'registered';
      if (before) {
        const now = namesOf(commands);
        entry.created = now.filter((name) => !before.includes(name));
        entry.removed = before.filter((name) => !now.includes(name));
      }
      logger.info(
        target.guildId
          ? `Registered ${result.length} command(s) to dev guild ${target.guildId}.` // i18n-ignore: a log
          : `Registered ${result.length} command(s) globally (can take up to 1 hour to propagate).`, // i18n-ignore: a log
      );
    } catch (error) {
      entry.status = 'failed';
      entry.error = describeError(error);
      if (strict) throw error;
      const wait = error?.retryAfter ?? error?.rawError?.retry_after;
      logger.warn(`The commands could not be registered${target.guildId ? ` in ${target.guildId}` : ''} (${error?.status ?? ''} ${error?.message ?? error}${wait ? `, Discord asks to wait ${wait}s` : ''}). Starting anyway with the ones registered before; the next start tries again.`);
    }
  }

  const privateCommandsByGuild = new Map();
  for (const registration of collectPrivateGuildCommandData()) {
    const commands = privateCommandsByGuild.get(registration.guildId) ?? [];
    commands.push(registration.data);
    privateCommandsByGuild.set(registration.guildId, commands);
  }

  for (const [guildId, privateCommands] of privateCommandsByGuild) {
    const privateKey = `private_commands_hash:${guildId}`;
    const privateHash = hashOf(privateCommands);
    if (!force && await lastDeployed(settings, privateKey) === privateHash) continue;
    try {
      const privateRoute = Routes.applicationGuildCommands(config.clientId, guildId);
      const existing = await rest.get(privateRoute);
      const privateNames = new Set(privateCommands.map((command) => command.name));
      const merged = existing.filter((command) => !privateNames.has(command.name));
      const privateResult = await rest.put(privateRoute, { body: [...merged, ...privateCommands] });
      await rememberDeployed(settings, privateKey, privateHash);
      logger.info(`Registered ${privateCommands.length} private command(s) to guild ${guildId}; guild now has ${privateResult.length} command(s).`);
    } catch (error) {
      if (strict) throw error;
      logger.warn(`The private commands of guild ${guildId} could not be registered: ${error?.message ?? error}`);
    }
  }

  return result;
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
}

module.exports = { deployCommands, announceDeployReport, getDeployReport: () => lastReport };
