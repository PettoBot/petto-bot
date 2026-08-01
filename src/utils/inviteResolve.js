const inviteCache = require('./inviteCache');

// Two separate GuildMemberAdd listeners (invite-tracking DB + the join log) both need to know
// which invite a join used, and both diff the same before/after invite snapshot to figure it
// out. If each ran its own diff independently, whichever runs second would diff against a cache
// the first one already replaced with the post-join state, and always come up empty. Memoizing
// per (guild, member) for a few seconds means only the first caller actually fetches/diffs, and
// the other reuses that in-flight result.
const pending = new Map(); // `${guildId}:${memberId}` -> Promise<Invite|null>
const PENDING_TTL_MS = 10_000;

/** The invite a member's join used, or null if it can't be determined (no permission, vanity/OAuth join, etc). */
async function resolveJoinInvite(member) {
  const guild = member.guild;
  const key = `${guild.id}:${member.id}`;
  const existing = pending.get(key);
  if (existing) return existing;

  const promise = (async () => {
    if (!guild.members.me.permissions.has('ManageGuild')) return null;
    try {
      const before = inviteCache.getGuildCache(guild.id) ?? new Map();
      const afterInvites = await guild.invites.fetch().catch(() => null);
      if (!afterInvites) return null;

      let usedInvite = null;
      for (const invite of afterInvites.values()) {
        const prev = before.get(invite.code);
        if (!prev || (invite.uses ?? 0) > prev.uses) {
          usedInvite = invite;
          break;
        }
      }

      inviteCache.replaceGuildCache(guild.id, afterInvites);
      return usedInvite;
    } catch {
      return null;
    }
  })();

  pending.set(key, promise);
  setTimeout(() => pending.delete(key), PENDING_TTL_MS);
  return promise;
}

module.exports = { resolveJoinInvite };
