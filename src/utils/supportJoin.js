// Adds a person to Petto's support server with the permission they gave on Discord's screen when they signed in to the dashboard and said yes
// to "do you want Petto to add you to the support server?" (the scope `guilds.join`; the website asks, this only does what it was asked).
// The access token is used once and is never logged or kept.
const config = require('../config');
const logger = require('./logger');

// The support server (petto.sbs/support points to it); PETTO_SUPPORT_GUILD_ID can move it.
const DEFAULT_SUPPORT_GUILD_ID = '1414452131850879080';

/**
 * @returns {Promise<{ ok: boolean, code?: 'no_server' | 'refused' | 'failed' }>} ok also when the person was already in the server
 */
async function joinSupportServer(client, userId, accessToken) {
  const guildId = config.supportGuildId || DEFAULT_SUPPORT_GUILD_ID;
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, code: 'no_server' };
  try {
    // discord.js answers with the member, or nothing when the person was already in the server.
    await guild.members.add(userId, { accessToken });
    return { ok: true };
  } catch (error) {
    // Banned from the server, the token expired, or Petto cannot create invites there: only the status is said, never the token.
    const status = Number(error?.status ?? error?.httpStatus ?? 0);
    logger.warn(`Support server: could not add a person after the dashboard login (Discord said ${status || 'an error'}).`);
    return { ok: false, code: status === 403 || status === 401 ? 'refused' : 'failed' };
  }
}

module.exports = { DEFAULT_SUPPORT_GUILD_ID, joinSupportServer };
