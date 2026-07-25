const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');
const logger = require('../utils/logger');

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

  if (!fs.existsSync(COMMANDS_DIR)) {
    logger.warn(`Commands directory not found: ${COMMANDS_DIR}`);
    return client.commands;
  }

  for (const filePath of findCommandFiles(COMMANDS_DIR)) {
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);

    if (!command?.data || typeof command.execute !== 'function') {
      logger.warn(`Skipping invalid command file (missing "data" or "execute"): ${filePath}`);
      continue;
    }

    command.category = categoryFromPath(filePath);
    client.commands.set(command.data.name, command);

    for (const alias of command.aliases ?? []) {
      const key = alias.toLowerCase();
      if (client.commands.has(key) || client.commandAliases.has(key)) {
        logger.warn(`Skipping alias "${key}" for /${command.data.name}: already used by another command/alias.`);
        continue;
      }
      client.commandAliases.set(key, command.data.name);
    }
  }

  logger.info(`Loaded ${client.commands.size} command(s), ${client.commandAliases.size} alias(es).`);
  return client.commands;
}

/**
 * Reads every command's `data` (used by deploy-commands.js), without needing a client.
 * Most commands are prefix-only now (see src/events/messageCreateCommands.js) — their
 * `data` sticks around purely so the prefix parser can introspect subcommands/options,
 * it's not meant to reach Discord's slash command API. Only context-menu commands (no
 * prefix equivalent exists) and anything explicitly opted in via `command.interactive =
 * true` (reserved for future game/interactive-style commands) actually get deployed.
 */
function collectCommandData() {
  return findCommandFiles(COMMANDS_DIR)
    .map((filePath) => require(filePath))
    .filter((command) => command?.data)
    .filter((command) => {
      const isChatInput = (command.data.toJSON().type ?? 1) === 1;
      return !isChatInput || command.interactive === true;
    })
    .map((command) => command.data.toJSON());
}

module.exports = { loadCommands, collectCommandData, findCommandFiles, COMMANDS_DIR };
