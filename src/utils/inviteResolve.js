const inviteCache = require('./inviteCache');

// Two separate GuildMemberAdd listeners (invite-tracking DB + the join log) both need to know
// which invite a join used, and both diff the same before/after invite snapshot to figure it
// out. If each ran its own diff independently, whichever runs second would diff against a cache
// the first one already replaced with the post-join state, and always come up empty. Memoizing
// per (guild, member) for a few seconds means only the first caller actually fetches/diffs, and
// the other reuses that in-flight result.
const pending = new Map(); // `${guildId}:${memberId}` -> Promise<Invite|null>
const PENDING_TTL_MS = 10_000;
const MAX_PENDING = 500;

/** The invite a member's join used, or null if it can't be determined (no permission, vanity/OAuth join, etc). */
async function resolveJoinInvite(member) {
  const guild = member.guild;
  const key = `${guild.id}:${member.id}`;
  const existing = pending.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const before = inviteCache.getGuildCache(guild.id);
      // One request per join (none when Petto cannot read the invites or the server is backing off after an error).
      const afterInvites = await inviteCache.fetchInvites(guild);
      if (!afterInvites) return null;
      inviteCache.replaceGuildCache(guild.id, afterInvites);
      // Without a snapshot from before there is nothing to compare: the list just read is the start for the next join, and this one is
      // told as unknown instead of pointing at whichever invite comes first.
      if (!before) return null;

      for (const invite of afterInvites.values()) {
        const prev = before.get(invite.code);
        if (!prev || (invite.uses ?? 0) > prev.uses) return invite;
      }

      // A single-use (or last-use) invite disappears when it is used, so it is not in the new list: it is the one that is gone.
      for (const [code, prev] of before) {
        if (!afterInvites.has(code) && prev.maxUses > 0 && prev.uses + 1 >= prev.maxUses) {
          return { code, inviter: prev.inviterId ? { id: prev.inviterId } : null, uses: prev.maxUses };
        }
      }
      return null;
    } catch {
      return null;
    }
  })();

  inviteCache.remember(pending, key, promise, MAX_PENDING);
  setTimeout(() => pending.delete(key), PENDING_TTL_MS).unref?.();
  return promise;
}

const vanityUses = new Map(); // guildId -> uses of the vanity URL the last time it was looked at (capped, only servers that have a vanity URL)

/** True when the join came through the server's vanity URL (its use count went up). Remembers the count for the next join. */
async function wasVanityJoin(guild) {
  if (!guild.vanityURLCode || inviteCache.isBackedOff(guild.id)) return false;
  const data = await guild.fetchVanityData().catch((error) => { inviteCache.noteFetchError(guild.id, error); return null; });
  if (!data) return false;
  const before = vanityUses.get(guild.id);
  inviteCache.remember(vanityUses, guild.id, data.uses);
  return before !== undefined && data.uses > before;
}

module.exports = { resolveJoinInvite, wasVanityJoin, vanityUses, pending };
