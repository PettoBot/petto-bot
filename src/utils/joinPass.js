// The one-time join pass of the anti-raid (!automod join-pass). Several join checks run for the same member at once, so they
// share one lookup: the first one reads the pass and spends it, the others get the same answer.
const passes = require('../db/joinPasses');
const logger = require('./logger');

const SHARE_MS = 60_000;
const pending = new Map(); // guildId:userId -> Promise<boolean>

/** True when the member joined with a pass: the anti-raid checks leave them alone. The pass is used up. */
function usePass(member, db = passes) {
  const key = `${member.guild.id}:${member.id}`;
  if (pending.has(key)) return pending.get(key);
  const lookup = (async () => {
    const has = await db.hasPass(member.guild.id, member.id).catch(() => false);
    if (has) await db.removePass(member.guild.id, member.id).catch((err) => logger.warn(`Could not spend the join pass of ${member.id} in ${member.guild.id}: ${err.message}`));
    return has;
  })();
  pending.set(key, lookup);
  setTimeout(() => { if (pending.get(key) === lookup) pending.delete(key); }, SHARE_MS).unref?.();
  return lookup;
}

module.exports = { usePass };
