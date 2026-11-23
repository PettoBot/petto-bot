// i18n-ignore-file: pure rules of the ceramos (the currency of the profile): numbers and ids, nothing here is shown as it is.
// What a day gives, when it can be claimed again, what the badges of the shop cost and what a frame costs. No database and no Discord, so
// scripts/check-ceramos.js tests the same code the commands run.
// Written in TypeScript: `npm run build:ts` compiles it over utils/ceramos.js.
import type { PlanKey } from './profileBadges';

/** The ceramos a person claims each day: 2 with no plan, then 5, 10 and 20 by plan. */
export const DAILY: Readonly<Record<PlanKey | 'none', number>> = { none: 2, bronze: 5, silver: 10, gold: 20 };
export const dailyAmount = (plan: PlanKey | null): number => DAILY[plan ?? 'none'];

/** What a badge of the shop costs (bought once, it stays; the ceramos are only for it and for its frames). */
export const BADGE_PRICE = 250;

export type FrameId = 'normal' | 'bright' | 'divine';
export interface FrameDef { id: FrameId; level: number; /** What it costs to get it from the frame just below. */ cost: number }
export const FRAMES: readonly FrameDef[] = [
  { id: 'normal', level: 0, cost: 0 },
  { id: 'bright', level: 1, cost: 150 },
  { id: 'divine', level: 2, cost: 400 },
];
export const frameById = (id: string | null | undefined): FrameDef => FRAMES.find((frame) => frame.id === id) ?? FRAMES[0];

/** The next frame after `current`, or null when it is the last one. */
export const nextFrame = (current: string | null | undefined): FrameDef | null => FRAMES[frameById(current).level + 1] ?? null;

/** The UTC day of a moment as `YYYY-MM-DD`: a day to claim is a day of the calendar, the same for everybody. */
export const dayOf = (when: Date): string => when.toISOString().slice(0, 10);

/** Whether a person can claim today, given the day they claimed last (a `YYYY-MM-DD` text, a Date or nothing), and when the next claim opens. */
export function claimStatus(lastDaily: string | Date | null | undefined, now: Date): { canClaim: boolean; nextAt: Date } {
  const last = lastDaily instanceof Date ? dayOf(lastDaily) : (lastDaily ? String(lastDaily).slice(0, 10) : null);
  const today = dayOf(now);
  const tomorrow = new Date(`${today}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return { canClaim: last !== today, nextAt: last === today ? tomorrow : now };
}

/** A whole, positive number of ceramos, or null: what an amount typed by a person or the team has to be. */
export function parseAmount(value: unknown, max = 1_000_000): number | null {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isInteger(number) && number > 0 && number <= max ? number : null;
}
