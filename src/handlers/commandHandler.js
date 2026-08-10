const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');
const logger = require('../utils/logger');
const { aliasesFor, DEFAULT_PREFIX_ROUTES } = require('../utils/defaultCommandAliases');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

/**
 * Recursively finds every command file under src/commands/**.
 * Category is just a subfolder (e.g. commands/moderation/ban.js) — it has
 * no effect on registration, it's purely for organizing the source tree.
 */
function findCommandFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findCommandFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

/** The immediate subfolder under src/commands/ a file lives in (e.g. "moderation", "config") — used to group !help by category. */
function categoryFromPath(filePath) {
  const rel = path.relative(COMMANDS_DIR, filePath);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0] : 'other';
}

/**
 * Loads every command module and attaches them to client.commands, plus
 * client.commandAliases (alias -> canonical name, from each command's optional
 * `aliases` array, e.g. `aliases: ['h', 'hlp']` on help.js) — messageCreateCommands.js
 * checks both maps so a prefix command can be invoked by its short alias too.
 * Each command file must export { data: SlashCommandBuilder, execute(interaction) }.
 */
function loadCommands(client) {
  client.commands = new Collection();
  client.commandAliases = new Collection();
  client.commandRoutes = new Collection();

  if (!fs.existsSync(COMMANDS_DIR)) {
    logger.warn(`Commands directory not found: ${COMMANDS_DIR}`);
    return client.commands;
  }

  const commandFiles = findCommandFiles(COMMANDS_DIR);
  const commandNames = new Set();

  // Reserve every canonical command name before aliases are registered. This
  // prevents an alias from an earlier file taking the name of a later command.
  for (const filePath of commandFiles) {
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);
    if (command?.data?.name) commandNames.add(command.data.name.toLowerCase());
  }

  for (const filePath of commandFiles) {
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);

    if (!command?.data || typeof command.execute !== 'function') {
      logger.warn(`Skipping invalid command file (missing "data" or "execute"): ${filePath}`);
      continue;
    }

    command.category = categoryFromPath(filePath);
    if (client.commands.has(command.data.name)) {
      const existing = client.commands.get(command.data.name);
      logger.warn(`Skipping duplicate command name "${command.data.name}" from ${filePath}; already loaded from ${existing.filePath ?? 'another command file'}.`);
      continue;
    }
    command.filePath = filePath;
    // Merge curated aliases here so prefix parsing and !help stay in sync.
    const requestedAliases = [...new Set([...(command.aliases ?? []), ...aliasesFor(command.data.name)])]
      .map((alias) => String(alias).toLowerCase());
    const acceptedAliases = [];
    client.commands.set(command.data.name, command);

    for (const alias of requestedAliases) {
      const key = alias.toLowerCase();
      if (commandNames.has(key) || client.commands.has(key) || client.commandAliases.has(key)) {
        logger.warn(`Skipping alias "${key}" for /${command.data.name}: already used by another command/alias.`);
        continue;
      }
      client.commandAliases.set(key, command.data.name);
      acceptedAliases.push(key);
    }
    command.aliases = acceptedAliases;
  }

  for (const route of DEFAULT_PREFIX_ROUTES) {
    const key = route.alias.toLowerCase();
    if (!client.commands.has(route.command)) {
      logger.warn(`Skipping prefix route "${key}": target command "${route.command}" was not loaded.`);
      continue;
    }
    if (client.commands.has(key) || client.commandAliases.has(key) || client.commandRoutes.has(key)) {
      logger.warn(`Skipping prefix route "${key}" for ${route.command}: already used by another command/alias/route.`);
      continue;
    }
    client.commandRoutes.set(key, route);
    const target = client.commands.get(route.command);
    target.prefixRoutes = [...(target.prefixRoutes ?? []), route];
  }

  logger.info(`Loaded ${client.commands.size} command(s), ${client.commandAliases.size} alias(es), ${client.commandRoutes.size} prefix route(s).`);
  return client.commands;
}

/**
 * Reads every command's `data` (used by deploy-commands.js), without needing a client.
 * Roleplay chat-input commands and explicitly marked slash-only commands are
 * registered with Discord. Other chat-input builders stay available only to the
 * configured message-prefix parser.
 */
function collectCommandData() {
  return findCommandFiles(COMMANDS_DIR)
    .map((filePath) => ({ filePath, command: require(filePath) }))
    .filter(({ command }) => command?.data)
    // Prefix-only commands keep a SlashCommandBuilder for the shared parser,
    // but must never be registered as Discord slash commands.
    .filter(({ command }) => !command.prefixOnly)
    .filter(({ filePath, command }) => {
      const type = command.data.toJSON().type ?? 1;
      return type !== 1 || command.slashOnly || categoryFromPath(filePath) === 'roleplay';
    })
    .map(({ command }) => command.data.toJSON());
}

module.exports = { loadCommands, collectCommandData, findCommandFiles, COMMANDS_DIR };
