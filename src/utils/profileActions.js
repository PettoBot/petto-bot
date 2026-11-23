"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setIdentity = setIdentity;
exports.saveShowcase = saveShowcase;
// i18n-ignore-file: the rules of changing the badges and the showcase of a profile; the words come from the callers (the commands and the web routes).
// Turning a free badge of the Fablo pack on or off and saving the showcase, written once for `/profile` and for the page of badges of the website.
// Written in TypeScript: `npm run build:ts` compiles it over utils/profileActions.js.
const rules = require('./profileBadges');
const view = require('./profileView');
const profileDb = require('../db/userProfile');
/** Turns a badge that the person picks for themselves on or off. A new one goes to the showcase when there is a free place. */
async function setIdentity(userId, badgeId, enabled) {
    if (!rules.isSelfBadge(badgeId))
        return { ok: false, reason: 'notYours' };
    if (!enabled) {
        const had = await profileDb.removeBadge(userId, badgeId);
        return { ok: true, changed: had, showcase: (await view.profileState(userId)).showcase };
    }
    const isNew = await profileDb.addBadge(userId, badgeId, 'self');
    if (isNew) {
        const state = await view.profileState(userId);
        if (state.showcase.length < state.slots && !state.showcase.includes(badgeId))
            await profileDb.setShowcase(userId, [...state.showcase, badgeId]);
    }
    return { ok: true, changed: isNew, showcase: (await view.profileState(userId)).showcase };
}
/** Saves the showcase in the order given, cut to what the person owns and what their plan holds. Returns what was kept and what was left out. */
async function saveShowcase(userId, chosen) {
    const state = await view.profileState(userId);
    const kept = rules.normalizeShowcase(chosen, state.owned, state.slots);
    const dropped = [...new Set(chosen)].filter((id) => !kept.includes(id));
    await profileDb.setShowcase(userId, kept);
    return { kept, dropped, slots: state.slots };
}
