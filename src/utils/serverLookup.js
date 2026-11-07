// Which server `/server info` (and `!serverinfo <id>`) tells about. Without an ID it is the server where the command was written. With an
// ID it is any server Petto is in, but only for a person who is a member of it (the card shows the owner, the counts and the features), and
// for the team of Petto (its owner and developers), who can ask about any server Petto is in.
/** The ID a person typed, cleaned of what gets pasted along with it (spaces, quotes, `<` `>`, a trailing comma or dot): null if it is not an ID. */
function cleanServerId(text) {
  const id = String(text ?? '').replace(/[\s"'`<>,.;:()[\]]/g, '');
  return /^\d{15,25}$/.test(id) ? id : null;
}

/**
 * `{ guild }` for the server to show, or `{ error }`: `bad_id` (what was typed is not an ID), `not_found` (Petto is not in it, or the
 * person is not a member: said together, so nobody learns which servers Petto is in) or `unavailable` (Discord could not say).
 * `current` is the server where the command was written (null in a message with no server).
 */
async function findServerForInfo({ client, wanted, userId, current }) {
  const text = String(wanted ?? '').trim();
  if (!text) return current ? { guild: current } : { error: 'not_found' };
  const id = cleanServerId(text);
  if (!id) return { error: 'bad_id' };
  if (current && id === current.id) return { guild: current };
  const guild = client.guilds.cache.get(id) ?? await client.guilds.fetch(id).catch(() => null);
  if (!guild) return { error: 'not_found' };
  // Read here and not when the file loads: the team is the owner and the developers of the configuration.
  if (require('./maintenance').isTeam(userId)) return { guild };
  if (guild.members?.cache?.has(userId)) return { guild };
  try {
    const member = await guild.members.fetch(userId);
    return member ? { guild } : { error: 'not_found' };
  } catch (err) {
    // Discord says "Unknown Member" (10007) for someone who is not in the server; any other failure is not an answer.
    return { error: err?.code === 10007 ? 'not_found' : 'unavailable' };
  }
}

module.exports = { cleanServerId, findServerForInfo };
