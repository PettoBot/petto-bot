// i18n-ignore-file: log lines for the team of Petto, not messages for the members.
// Petto joined a server: the second set of slash commands (`/case`, `/note`, `/jail`...: the 100 commands Discord gives each server on top of the global 100)
// is registered there in the background. Nothing is sent when the server already has them (the check compares with what Discord has), so a server that is
// announced again at start costs one read. A failure only means the commands show up on the next start (handlers/deployCommands.js).
const { Events } = require('discord.js');
const { deployGuildCommands } = require('../handlers/deployCommands');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    const result = await deployGuildCommands(guild.id).catch((error) => ({ status: 'failed', error: error?.message ?? String(error) }));
    if (result.status === 'registered') logger.info(`Registered the server commands in ${guild.id} (${guild.name}).`);
    else if (result.status === 'failed' || result.status === 'limited') logger.warn(`The server commands could not be registered in ${guild.id}: ${result.error}`);
  },
};
