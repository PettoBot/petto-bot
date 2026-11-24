"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanSettings = cleanSettings;
exports.state = state;
exports.saveSettings = saveSettings;
exports.grant = grant;
// i18n-ignore-file: the answers are codes and numbers; the website writes the words.
// Giving ceramos from the dashboard: who may (the owner and the people the owner lists), how much at once and how much a day. Kept apart from the API of the pages so the
// checks can run it without the rest of the profile.
// Written in TypeScript: `npm run build:ts` compiles it over utils/ceramosGrantActions.js.
const grantDb = require('../db/ceramosGrant');
const walletDb = require('../db/ceramos');
const ID = /^\d{15,25}$/;
const clamp = (value, min, max, fallback) => {
    const n = typeof value === 'number' ? Math.floor(value) : Number.NaN;
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
/** Checks the settings the owner sends. Anything wrong becomes the current value. */
function cleanSettings(body, current) {
    const people = Array.isArray(body.people) ? [...new Set(body.people.filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, 20) : current.people;
    return {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
        maxPerGrant: clamp(body.maxPerGrant, 1, 100_000, current.maxPerGrant),
        maxPerDay: clamp(body.maxPerDay, 1, 1_000_000, current.maxPerDay),
        people,
    };
}
/** What the page of a person needs: whether they may give, the limits, what is left today, and the last gifts. The owner also gets the whole settings. */
async function state(userId, ownerId) {
    const settings = await grantDb.getSettings();
    const isOwner = String(userId) === String(ownerId);
    const allowed = isOwner || (settings.enabled && settings.people.includes(userId));
    if (!allowed)
        return { ok: true, allowed: false };
    const given = isOwner ? 0 : await grantDb.givenToday(userId);
    return { ok: true, allowed: true, isOwner, enabled: settings.enabled, maxPerGrant: settings.maxPerGrant, maxPerDay: settings.maxPerDay, leftToday: isOwner ? null : Math.max(0, settings.maxPerDay - given), settings: isOwner ? settings : undefined, recent: await grantDb.recentGrants(15) };
}
async function saveSettings(body) {
    const next = cleanSettings(body, await grantDb.getSettings());
    await grantDb.saveSettings(next);
    return { ok: true, settings: next };
}
/** Gives ceramos to a person. The owner is only held by the limit of one gift; the rest of the team also by the daily limit, and only while the switch is on. */
async function grant(adminId, ownerId, body) {
    const settings = await grantDb.getSettings();
    const isOwner = String(adminId) === String(ownerId);
    if (!isOwner && !(settings.enabled && settings.people.includes(adminId)))
        return { ok: false, error: 'forbidden' };
    const person = typeof body.person === 'string' && ID.test(body.person) ? body.person : null;
    if (!person)
        return { ok: false, error: 'bad_person' };
    const amount = typeof body.amount === 'number' && Number.isInteger(body.amount) ? body.amount : 0;
    if (amount < 1)
        return { ok: false, error: 'bad_amount' };
    if (amount > settings.maxPerGrant)
        return { ok: false, error: 'too_much', max: settings.maxPerGrant };
    if (!isOwner) {
        const left = settings.maxPerDay - await grantDb.givenToday(adminId);
        if (amount > left)
            return { ok: false, error: 'daily_limit', left: Math.max(0, left) };
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 60) : '';
    const balance = await walletDb.give(person, amount, 'grant', note || null, adminId);
    return { ok: true, person, amount, balance };
}
