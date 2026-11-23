"use strict";
// i18n-ignore-file: the catalog of badges; the names a person reads are in the embeds catalog (`profile.badge.<id>`), nothing here is shown as it is.
// The badges of the profile of a person (the image of `/profile`): which exist, how each one is had and how many fit in the showcase.
// Pure rules with no database and no Discord, so scripts/check-profile-card.js tests the same code the command runs.
// Written in TypeScript: `npm run build:ts` compiles it over utils/profileBadges.js.
Object.defineProperty(exports, "__esModule", { value: true });
exports.planBadgeId = exports.slotsFor = exports.MAX_SLOTS = exports.SHOWCASE_SLOTS = exports.isSelfBadge = exports.badgeById = exports.BADGES = exports.PLAN_KEYS = void 0;
exports.planOf = planOf;
exports.ownedBadges = ownedBadges;
exports.normalizeShowcase = normalizeShowcase;
exports.PLAN_KEYS = ['bronze', 'silver', 'gold'];
exports.BADGES = [
    { id: 'plan-bronze', unlock: 'plan', art: 'plan-bronze.png', color: '#b9792f' },
    { id: 'plan-silver', unlock: 'plan', art: 'plan-silver.png', color: '#b8bcc4' },
    { id: 'plan-gold', unlock: 'plan', art: 'plan-gold.png', color: '#f4cf3a' },
    // The Fablo pack: the free badges everybody can turn on.
    { id: 'furro', unlock: 'self', art: 'furro.png', color: '#8cc7ff', pack: 'fablo' },
    { id: 'boykisser', unlock: 'self', art: 'boykisser.png', color: '#b98cff', pack: 'fablo' },
    { id: 'hetero', unlock: 'self', art: 'hetero.png', color: '#6fb4ff', pack: 'fablo' },
    { id: 'femboy', unlock: 'self', art: 'femboy.png', color: '#ff8fc2', pack: 'fablo' },
];
const BY_ID = new Map(exports.BADGES.map((badge) => [badge.id, badge]));
const badgeById = (id) => BY_ID.get(id) ?? null;
exports.badgeById = badgeById;
const isSelfBadge = (id) => BY_ID.get(id)?.unlock === 'self';
exports.isSelfBadge = isSelfBadge;
/** How many badges the showcase of the profile holds, by plan: one with no plan, then 2, 4 and 6. */
exports.SHOWCASE_SLOTS = { none: 1, bronze: 2, silver: 4, gold: 6 };
exports.MAX_SLOTS = 6;
/** The plan a `plan_key` of the database stands for, or null when it is not one of the three plans of a person (the Premium of a server is another thing). */
function planOf(planKey) {
    const key = String(planKey ?? '').toLowerCase();
    return exports.PLAN_KEYS.includes(key) ? key : null;
}
const slotsFor = (plan) => exports.SHOWCASE_SLOTS[plan ?? 'none'];
exports.slotsFor = slotsFor;
/** The badge of a plan, which is always owned while the plan is active. */
const planBadgeId = (plan) => `plan-${plan}`;
exports.planBadgeId = planBadgeId;
/** What a person owns: what they have saved plus the badge of their plan. */
function ownedBadges(saved, plan) {
    const owned = new Set(saved.filter((id) => BY_ID.has(id) && BY_ID.get(id)?.unlock !== 'plan'));
    if (plan)
        owned.add((0, exports.planBadgeId)(plan));
    return [...owned];
}
/** The list a person chose, cut to what they own and what fits: no repeats, no badge they do not have, at most `slots`. */
function normalizeShowcase(chosen, owned, slots) {
    const have = new Set(owned);
    const out = [];
    for (const id of chosen) {
        if (out.length >= Math.max(0, Math.min(slots, exports.MAX_SLOTS)))
            break;
        if (have.has(id) && !out.includes(id))
            out.push(id);
    }
    return out;
}
