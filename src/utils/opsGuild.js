// The server where the private team controls work (`!guildsend`, `!leaveguild` and the buttons of the alerts). It can be a server of the
// team that is not the support server: PETTO_OPS_GUILD_ID. Without it, the support server is used as before: PETTO_SUPPORT_GUILD_ID, and when
// that is empty the server of the join-log channel.
const config = require('../config');

async function resolveOpsGuildId(client) {
  if (config.opsGuildId) return config.opsGuildId;
  if (config.supportGuildId) return config.supportGuildId;
  const joinLog = await client.channels.fetch(config.opsChannels?.joinLog).catch(() => null);
  return joinLog?.guildId ?? null;
}

module.exports = { resolveOpsGuildId };
