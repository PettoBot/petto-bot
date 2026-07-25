// In-memory snapshot of each guild's invites (code -> {uses, inviterId}), used to diff
// against a fresh fetch on member join and figure out which invite was used — Discord
// doesn't tell you directly, so this is the standard "diff the uses count" approach.
const cache = new Map(); // guildId -> Map<code, { uses, inviterId }>

function snapshotFromCollection(invites) {
  const map = new Map();
  for (const invite of invites.values()) {
    map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
  }
  return map;
}

async function warmGuild(guild) {
  try {
    const invites = await guild.invites.fetch();
    cache.set(guild.id, snapshotFromCollection(invites));
  } catch {
    // Missing Manage Server permission or similar — invite tracking silently no-ops for this guild.
  }
}

function getGuildCache(guildId) {
  return cache.get(guildId);
}

function setInvite(guildId, code, data) {
  if (!cache.has(guildId)) cache.set(guildId, new Map());
  cache.get(guildId).set(code, data);
}

function deleteInvite(guildId, code) {
  cache.get(guildId)?.delete(code);
}

function replaceGuildCache(guildId, invites) {
  cache.set(guildId, snapshotFromCollection(invites));
}

module.exports = { warmGuild, getGuildCache, setInvite, deleteInvite, replaceGuildCache };
