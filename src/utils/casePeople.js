// Who is behind each case of a list: the sanctioned member and the moderator, with their picture. A person that Discord does not know any more
// (a deleted account) or cannot be found is "unknown" in the list, instead of an @ that shows nothing. Looked up once and kept for a few minutes,
// so turning the pages of a list does not ask Discord again for the same people.
const KEEP_MS = 5 * 60_000;
const MAX_KEPT = 500;
const kept = new Map();

const isDeleted = (user) => /^deleted_user_/i.test(String(user?.username ?? ''));

async function lookup(client, id) {
  const hit = kept.get(id);
  if (hit && hit.until > Date.now()) return hit.person;
  const user = client.users?.cache?.get(id) ?? await client.users?.fetch(id).catch(() => null);
  const person = user && !isDeleted(user) ? { id, known: true, avatarUrl: user.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null } : { id, known: false, avatarUrl: null };
  if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value);
  kept.set(id, { person, until: Date.now() + KEEP_MS });
  return person;
}

/** A Map from user id to `{ id, known, avatarUrl }` for the members and moderators of these case rows. */
async function resolveCasePeople(client, rows) {
  const ids = [...new Set(rows.flatMap((row) => [row.user_id, row.moderator_id]).filter(Boolean).map(String))];
  const people = await Promise.all(ids.map((id) => lookup(client, id)));
  return new Map(people.map((person) => [person.id, person]));
}

module.exports = { resolveCasePeople };
