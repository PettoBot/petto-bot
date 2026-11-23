// i18n-ignore-file: the plans are described by the website in each language; here are only the numbers.
// What each plan of a person gives: the price, the uses of the AI a day, the places in the showcase, the badges of their own, the ceramos a day, the freezes of a streak a
// month. Pure, so the website, the commands and scripts/check-user-plans.js read the same numbers. The prices are in US dollars a month; nothing is charged yet.
import type { PlanKey } from './profileBadges';

export interface PlanPerks { price: number; aiPerDay: number; showcaseSlots: number; ownBadges: number; ceramosPerDay: number; streakFreezes: number; limitsBonus: number; ownBackground: 'none' | 'still' | 'animated' }

export const PLAN_PERKS: Readonly<Record<PlanKey | 'free', PlanPerks>> = {
  free: { price: 0, aiPerDay: 5, showcaseSlots: 1, ownBadges: 0, ceramosPerDay: 2, streakFreezes: 0, limitsBonus: 0, ownBackground: 'none' },
  bronze: { price: 3.99, aiPerDay: 20, showcaseSlots: 2, ownBadges: 1, ceramosPerDay: 5, streakFreezes: 1, limitsBonus: 25, ownBackground: 'none' },
  silver: { price: 5.99, aiPerDay: 60, showcaseSlots: 4, ownBadges: 2, ceramosPerDay: 10, streakFreezes: 3, limitsBonus: 50, ownBackground: 'still' },
  gold: { price: 9.99, aiPerDay: 150, showcaseSlots: 6, ownBadges: 4, ceramosPerDay: 20, streakFreezes: 5, limitsBonus: 100, ownBackground: 'animated' },
};

export const MAX_GRANT_DAYS = 3650;

export type GrantChecked = { ok: true; plan: PlanKey; endsAt: string | null; note: string | null } | { ok: false; error: string };

/** Checks what the team sends to give a plan: the plan, for how many days (empty: no end), and an optional note. */
export function checkGrant(body: Record<string, unknown>, now: Date = new Date()): GrantChecked {
  const plan = body.plan === 'bronze' || body.plan === 'silver' || body.plan === 'gold' ? body.plan : null;
  if (!plan) return { ok: false, error: 'bad_plan' };
  let endsAt: string | null = null;
  if (body.days !== null && body.days !== undefined && body.days !== '') {
    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_GRANT_DAYS) return { ok: false, error: 'bad_days' };
    endsAt = new Date(now.getTime() + days * 86_400_000).toISOString();
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
  return { ok: true, plan, endsAt, note };
}
