const { REST, Routes } = require('discord.js');
const config = require('../config');
const { collectCommandData, collectPrivateGuildCommandData } = require('./commandHandler');
const crypto = require('node:crypto');
const logger = require('../utils/logger');

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
async function deployCommands({ force = false, strict = false, rest = new REST().setToken(config.token), settings = null } = {}) {
  const commands = collectCommandData();
  settings ??= defaultSettings();

  const route = config.devGuildId
    ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
    : Routes.applicationCommands(config.clientId);

  const key = `commands_hash:${config.devGuildId ?? 'global'}`;
  const hash = hashOf(commands);
  let result = null;
  if (!force && await lastDeployed(settings, key) === hash) {
    logger.info(`The ${commands.length} command(s) did not change since the last start: not registering them again.`);
  } else {
    try {
      result = await rest.put(route, { body: commands });
      await rememberDeployed(settings, key, hash);
      logger.info(
        config.devGuildId
          ? `Registered ${result.length} command(s) to dev guild ${config.devGuildId}.`
          : `Registered ${result.length} command(s) globally (can take up to 1 hour to propagate).`,
      );
    } catch (error) {
      if (strict) throw error;
      const wait = error?.retryAfter ?? error?.rawError?.retry_after;
      logger.warn(`The commands could not be registered (${error?.status ?? ''} ${error?.message ?? error}${wait ? `, Discord asks to wait ${wait}s` : ''}). Starting anyway with the ones registered before; the next start tries again.`);
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

module.exports = { deployCommands };
