"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayOf = exports.nextFrame = exports.frameById = exports.FRAMES = exports.BADGE_PRICE = exports.dailyAmount = exports.DAILY = void 0;
exports.claimStatus = claimStatus;
exports.parseAmount = parseAmount;
/** The ceramos a person claims each day: 2 with no plan, then 5, 10 and 20 by plan. */
exports.DAILY = { none: 2, bronze: 5, silver: 10, gold: 20 };
const dailyAmount = (plan) => exports.DAILY[plan ?? 'none'];
exports.dailyAmount = dailyAmount;
/** What a badge of the shop costs (bought once, it stays; the ceramos are only for it and for its frames). */
exports.BADGE_PRICE = 250;
exports.FRAMES = [
    { id: 'normal', level: 0, cost: 0 },
    { id: 'bright', level: 1, cost: 150 },
    { id: 'divine', level: 2, cost: 400 },
];
const frameById = (id) => exports.FRAMES.find((frame) => frame.id === id) ?? exports.FRAMES[0];
exports.frameById = frameById;
/** The next frame after `current`, or null when it is the last one. */
const nextFrame = (current) => exports.FRAMES[(0, exports.frameById)(current).level + 1] ?? null;
exports.nextFrame = nextFrame;
/** The UTC day of a moment as `YYYY-MM-DD`: a day to claim is a day of the calendar, the same for everybody. */
const dayOf = (when) => when.toISOString().slice(0, 10);
exports.dayOf = dayOf;
/** Whether a person can claim today, given the day they claimed last (a `YYYY-MM-DD` text, a Date or nothing), and when the next claim opens. */
function claimStatus(lastDaily, now) {
    const last = lastDaily instanceof Date ? (0, exports.dayOf)(lastDaily) : (lastDaily ? String(lastDaily).slice(0, 10) : null);
    const today = (0, exports.dayOf)(now);
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { canClaim: last !== today, nextAt: last === today ? tomorrow : now };
}
/** A whole, positive number of ceramos, or null: what an amount typed by a person or the team has to be. */
function parseAmount(value, max = 1_000_000) {
    const number = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    return Number.isInteger(number) && number > 0 && number <= max ? number : null;
}
