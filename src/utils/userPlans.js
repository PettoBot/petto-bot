"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_GRANT_DAYS = exports.PLAN_PERKS = void 0;
exports.checkGrant = checkGrant;
exports.PLAN_PERKS = {
    free: { price: 0, aiPerDay: 5, showcaseSlots: 1, ownBadges: 0, ceramosPerDay: 2, streakFreezes: 0, limitsBonus: 0, ownBackground: 'none' },
    bronze: { price: 3.99, aiPerDay: 20, showcaseSlots: 2, ownBadges: 1, ceramosPerDay: 5, streakFreezes: 1, limitsBonus: 25, ownBackground: 'none' },
    silver: { price: 5.99, aiPerDay: 60, showcaseSlots: 4, ownBadges: 2, ceramosPerDay: 10, streakFreezes: 3, limitsBonus: 50, ownBackground: 'still' },
    gold: { price: 9.99, aiPerDay: 150, showcaseSlots: 6, ownBadges: 4, ceramosPerDay: 20, streakFreezes: 5, limitsBonus: 100, ownBackground: 'animated' },
};
exports.MAX_GRANT_DAYS = 3650;
/** Checks what the team sends to give a plan: the plan, for how many days (empty: no end), and an optional note. */
function checkGrant(body, now = new Date()) {
    const plan = body.plan === 'bronze' || body.plan === 'silver' || body.plan === 'gold' ? body.plan : null;
    if (!plan)
        return { ok: false, error: 'bad_plan' };
    let endsAt = null;
    if (body.days !== null && body.days !== undefined && body.days !== '') {
        const days = Number(body.days);
        if (!Number.isInteger(days) || days < 1 || days > exports.MAX_GRANT_DAYS)
            return { ok: false, error: 'bad_days' };
        endsAt = new Date(now.getTime() + days * 86_400_000).toISOString();
    }
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
    return { ok: true, plan, endsAt, note };
}
