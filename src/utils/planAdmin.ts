// i18n-ignore-file: the answers are codes; the website writes the words.
// What the owner does with the plans of the people from the dashboard: see who has one, give one (for some days or with no end), and end one. Only the owner (the
// routes check it). The payment service will use the same functions later.
// Written in TypeScript: `npm run build:ts` compiles it over utils/planAdmin.js.
const plans = require('./userPlans') as typeof import('./userPlans');
const plansDb = require('../db/userPlans') as typeof import('../db/userPlans');

export async function list() {
  return { plans: await plansDb.listActive() };
}

export async function grant(ownerId: string, body: Record<string, unknown>) {
  const person = typeof body.person === 'string' && /^\d{15,25}$/.test(body.person) ? body.person : null;
  if (!person) return { ok: false as const, error: 'bad_person' };
  const checked = plans.checkGrant(body);
  if (!checked.ok) return { ok: false as const, error: (checked as { error: string }).error };
  await plansDb.setPlan(person, checked.plan, checked.endsAt, 'team', ownerId, checked.note);
  return { ok: true as const, person, plan: checked.plan, endsAt: checked.endsAt };
}

export async function end(body: Record<string, unknown>) {
  const person = typeof body.person === 'string' && /^\d{15,25}$/.test(body.person) ? body.person : null;
  if (!person) return { ok: false as const, error: 'bad_person' };
  const had = await plansDb.endPlan(person);
  return had ? { ok: true as const } : { ok: false as const, error: 'not_found' };
}
