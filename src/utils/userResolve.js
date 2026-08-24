const SNOWFLAKE_RE = /^\d{15,25}$/;

function cleanUserQuery(input) {
  const value = String(input ?? '').trim();
  if (!value) return '';

  const mention = /^<@!?(\d+)>$/.exec(value);
  if (mention) return mention[1];
  if (SNOWFLAKE_RE.test(value)) return value;

  // Also accept a plain @username in prefix commands. Discord's actual
  // mention format is handled above.
  return value.startsWith('@') ? value.slice(1).trim() : value;
}

function exactUserMatch(user, member, query) {
  const wanted = query.toLocaleLowerCase();
  const username = user?.username?.toLocaleLowerCase();
  const globalName = user?.globalName?.toLocaleLowerCase();
  const tag = user?.tag?.toLocaleLowerCase();
  const displayName = member?.displayName?.toLocaleLowerCase();
  const nickname = member?.nickname?.toLocaleLowerCase();

  if ([username, globalName, tag].filter(Boolean).includes(wanted)) return 'identity';
  if ([displayName, nickname].filter(Boolean).includes(wanted)) return 'display';
  return null;
}

function findExactMember(members, query) {
  const entries = [...members.values()];
  const identityMatches = entries.filter((member) => exactUserMatch(member.user, member, query) === 'identity');
  if (identityMatches.length === 1) return identityMatches[0];
  if (identityMatches.length > 1) return null;

  const displayMatches = entries.filter((member) => exactUserMatch(member.user, member, query) === 'display');
  return displayMatches.length === 1 ? displayMatches[0] : null;
}

async function resolveUser(client, input, guild = null, { includeBans = false } = {}) {
  const query = cleanUserQuery(input);
  if (!query) return null;

  if (SNOWFLAKE_RE.test(query)) {
    return client.users.fetch(query).catch(() => null);
  }

  if (!guild) return null;

  const cachedMember = findExactMember(guild.members.cache, query);
  if (cachedMember) return cachedMember.user;

  // Discord's member search is bounded and only runs for a name that was not
  // already cached; it avoids downloading the whole guild member list.
  const fetchedMembers = await guild.members
    .fetch({ query, limit: 10 })
    .catch(() => null);
  const fetchedMember = fetchedMembers ? findExactMember(fetchedMembers, query) : null;
  if (fetchedMember) return fetchedMember.user;

  // A banned user is no longer a member, so unban-by-username needs one
  // deliberate ban-list lookup. This path is enabled only for unban commands.
  if (includeBans) {
    const bans = await guild.bans.fetch().catch(() => null);
    const bannedUser = bans?.find((ban) => exactUserMatch(ban.user, null, query) === 'identity')?.user;
    if (bannedUser) return bannedUser;
  }

  return null;
}

/**
 * Resolves one or more user mentions, IDs, usernames, or display names. Names
 * are matched exactly to avoid moderating the wrong member; duplicate display
 * names require an ID or mention.
 */
async function resolveUsers(client, input, guild = null) {
  const tokens = [...new Set(String(input ?? '').split(/[\s,]+/).filter(Boolean))];
  const users = [];
  const failed = [];
  const seenUserIds = new Set();

  for (const token of tokens) {
    const user = await resolveUser(client, token, guild);
    if (!user) {
      failed.push(token);
      continue;
    }

    if (!seenUserIds.has(user.id)) {
      seenUserIds.add(user.id);
      users.push(user);
    }
  }

  return { users, failed };
}

module.exports = { cleanUserQuery, exactUserMatch, resolveUser, resolveUsers };
