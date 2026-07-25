const { REST, Routes } = require('discord.js');
const config = require('../config');
const { collectCommandData } = require('./commandHandler');
const logger = require('../utils/logger');

/**
 * Registers every command in src/commands/** with Discord. Uses PUT, which
 * fully replaces the command set, so it's safe (and idempotent) to call this
 * on every boot to keep Discord's registered commands in sync with the code.
 */
async function deployCommands() {
  const commands = collectCommandData();
  const rest = new REST().setToken(config.token);

  const route = config.devGuildId
    ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
    : Routes.applicationCommands(config.clientId);

  const result = await rest.put(route, { body: commands });

  logger.info(
    config.devGuildId
      ? `Registered ${result.length} command(s) to dev guild ${config.devGuildId}.`
      : `Registered ${result.length} command(s) globally (can take up to 1 hour to propagate).`,
  );

  return result;
}

module.exports = { deployCommands };
