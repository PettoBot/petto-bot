// i18n-ignore-file: the answers are codes and numbers; the website writes the words.
// Giving ceramos from the dashboard: who may (the owner and the people the owner lists), how much at once and how much a day. Kept apart from the API of the pages so the
// checks can run it without the rest of the profile.
// Written in TypeScript: `npm run build:ts` compiles it over utils/ceramosGrantActions.js.
const grantDb = require('../db/ceramosGrant') as typeof import('../db/ceramosGrant');
const walletDb = require('../db/ceramos') as typeof import('../db/ceramos');

const ID = /^\d{15,25}$/;
const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** Checks the settings the owner sends. Anything wrong becomes the current value. */
export function cleanSettings(body: Record<string, unknown>, current: import('../db/ceramosGrant').GrantSettings): import('../db/ceramosGrant').GrantSettings {
  const people = Array.isArray(body.people) ? [...new Set((body.people as unknown[]).filter((id): id is string => typeof id === 'string' && ID.test(id)))].slice(0, 20) : current.people;
  return {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    maxPerGrant: clamp(body.maxPerGrant, 1, 100_000, current.maxPerGrant),
    maxPerDay: clamp(body.maxPerDay, 1, 1_000_000, current.maxPerDay),
    people,
  };
}

/** What the page of a person needs: whether they may give, the limits, what is left today, and the last gifts. The owner also gets the whole settings. */
export async function state(userId: string, ownerId: string) {
  const settings = await grantDb.getSettings();
  const isOwner = String(userId) === String(ownerId);
  const allowed = isOwner || (settings.enabled && settings.people.includes(userId));
  if (!allowed) return { ok: true as const, allowed: false as const };
  const given = isOwner ? 0 : await grantDb.givenToday(userId);
  return { ok: true as const, allowed: true as const, isOwner, enabled: settings.enabled, maxPerGrant: settings.maxPerGrant, maxPerDay: settings.maxPerDay, leftToday: isOwner ? null : Math.max(0, settings.maxPerDay - given), settings: isOwner ? settings : undefined, recent: await grantDb.recentGrants(15) };
}

export async function saveSettings(body: Record<string, unknown>) {
  const next = cleanSettings(body, await grantDb.getSettings());
  await grantDb.saveSettings(next);
  return { ok: true as const, settings: next };
}

/** Gives ceramos to a person. The owner is only held by the limit of one gift; the rest of the team also by the daily limit, and only while the switch is on. */
export async function grant(adminId: string, ownerId: string, body: Record<string, unknown>) {
  const settings = await grantDb.getSettings();
  const isOwner = String(adminId) === String(ownerId);
  if (!isOwner && !(settings.enabled && settings.people.includes(adminId))) return { ok: false as const, error: 'forbidden' as const };
  const person = typeof body.person === 'string' && ID.test(body.person) ? body.person : null;
  if (!person) return { ok: false as const, error: 'bad_person' as const };
  const amount = typeof body.amount === 'number' && Number.isInteger(body.amount) ? body.amount : 0;
  if (amount < 1) return { ok: false as const, error: 'bad_amount' as const };
  if (amount > settings.maxPerGrant) return { ok: false as const, error: 'too_much' as const, max: settings.maxPerGrant };
  if (!isOwner) {
    const left = settings.maxPerDay - await grantDb.givenToday(adminId);
    if (amount > left) return { ok: false as const, error: 'daily_limit' as const, left: Math.max(0, left) };
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 60) : '';
  const balance = await walletDb.give(person, amount, 'grant', note || null, adminId);
  return { ok: true as const, person, amount, balance };
}
