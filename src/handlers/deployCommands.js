const { REST, Routes } = require('discord.js');
const config = require('../config');
const { collectCommandData, collectPrivateGuildCommandData } = require('./commandHandler');
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

  const privateCommandsByGuild = new Map();
  for (const registration of collectPrivateGuildCommandData()) {
    const commands = privateCommandsByGuild.get(registration.guildId) ?? [];
    commands.push(registration.data);
    privateCommandsByGuild.set(registration.guildId, commands);
  }

  for (const [guildId, privateCommands] of privateCommandsByGuild) {
    const privateRoute = Routes.applicationGuildCommands(config.clientId, guildId);
    const existing = await rest.get(privateRoute);
    const privateNames = new Set(privateCommands.map((command) => command.name));
    const merged = existing.filter((command) => !privateNames.has(command.name));
    const privateResult = await rest.put(privateRoute, { body: [...merged, ...privateCommands] });

    logger.info(`Registered ${privateCommands.length} private command(s) to guild ${guildId}; guild now has ${privateResult.length} command(s).`);
  }

  return result;
}

module.exports = { deployCommands };
