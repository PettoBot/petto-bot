const { REST, Routes } = require('discord.js');
const config = require('./src/config');
const { deployCommands, cleanupGuildCommands } = require('./src/handlers/deployCommands');
const logger = require('./src/utils/logger');

/** Every server the bot is in, read from Discord 200 at a time (this script runs without logging in). */
async function allGuildIds(rest) {
  const ids = [];
  let after = null;
  for (;;) {
    const page = await rest.get(Routes.userGuilds(), { query: new URLSearchParams({ limit: '200', ...(after ? { after } : {}) }) });
    ids.push(...page.map((guild) => guild.id));
    if (page.length < 200) return ids;
    after = page[page.length - 1].id;
  }
}

(async () => {
  await deployCommands({ force: true, strict: true });
  // With the commands global, the server-only copies (from a registration with DISCORD_DEV_GUILD_ID) are removed too: they show twice.
  if (!(config.devGuildIds ?? []).length) {
    const rest = new REST({ globalRequestsPerSecond: 4 }).setToken(config.token);
    await cleanupGuildCommands(null, { rest, force: true, guildIds: await allGuildIds(rest) });
  }
  process.exit(0);
})().catch((err) => {
  logger.error('Failed to deploy commands:', err);
  process.exit(1);
});
