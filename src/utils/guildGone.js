// i18n-ignore-file: internal decision for the team log, nothing that a server reads.
// Discord can say that a server was removed when Petto is still in it: after a restart or a reconnection the event arrives for a server that is not loaded yet, a bare
// object with an id and no name ("Petto left a server: undefined"). Telling the team that Petto left, and writing the departure down (the data of a server that
// left is deleted after some days), must only happen when Petto really is out. A server with a name was loaded and is removed as before; one without a name is asked to Discord.
const logger = require('./logger');

/** True when the event brings a server that was never loaded (it has an id and nothing else) or that is only unavailable. */
const isBare = (guild) => !guild || guild.available === false || typeof guild.name !== 'string' || guild.name.length === 0;

/**
 * 'in' (Petto is still there), 'out' (Discord says it is not) or 'unknown' (the question failed for another reason: nothing is told and nothing is written down).
 * `fetch` is `client.guilds.fetch`, so a server that Petto is in comes back and one it is not in answers 10004 (Unknown Guild) or 50001 (Missing Access).
 */
async function presence(client, guildId, { fetch = (id) => client.guilds.fetch(id) } = {}) {
  try {
    const found = await fetch(String(guildId));
    return found ? 'in' : 'out';
  } catch (error) {
    const code = Number(error?.code);
    const status = Number(error?.status);
    if (code === 10004 || code === 50001 || status === 404 || status === 403) return 'out';
    logger.localWarn(`Server ${guildId} was reported as removed and Discord could not say if Petto is still in it: ${error?.message ?? error}`);
    return 'unknown';
  }
}

module.exports = { isBare, presence };
