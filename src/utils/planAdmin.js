"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
exports.grant = grant;
exports.end = end;
// i18n-ignore-file: the answers are codes; the website writes the words.
// What the owner does with the plans of the people from the dashboard: see who has one, give one (for some days or with no end), and end one. Only the owner (the
// routes check it). The payment service will use the same functions later.
// Written in TypeScript: `npm run build:ts` compiles it over utils/planAdmin.js.
const plans = require('./userPlans');
const plansDb = require('../db/userPlans');
async function list() {
    return { plans: await plansDb.listActive() };
}
async function grant(ownerId, body) {
    const person = typeof body.person === 'string' && /^\d{15,25}$/.test(body.person) ? body.person : null;
    if (!person)
        return { ok: false, error: 'bad_person' };
    const checked = plans.checkGrant(body);
    if (!checked.ok)
        return { ok: false, error: checked.error };
    await plansDb.setPlan(person, checked.plan, checked.endsAt, 'team', ownerId, checked.note);
    return { ok: true, person, plan: checked.plan, endsAt: checked.endsAt };
}
async function end(body) {
    const person = typeof body.person === 'string' && /^\d{15,25}$/.test(body.person) ? body.person : null;
    if (!person)
        return { ok: false, error: 'bad_person' };
    const had = await plansDb.endPlan(person);
    return had ? { ok: true } : { ok: false, error: 'not_found' };
}
