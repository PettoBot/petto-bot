"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approvedImage = exports.MAX_UPLOAD_BYTES = exports.POLICY_VERSION = void 0;
exports.state = state;
exports.acceptPolicy = acceptPolicy;
exports.submit = submit;
exports.queue = queue;
exports.pendingFile = pendingFile;
exports.review = review;
// i18n-ignore-file: the answers are codes; the website writes the words.
// Own pictures (a background of the rank card made by the person): the plan that allows it, the policy they accept first, the picture waiting for review, and what the team does
// with it (approve, reject, take down, block). Only an approved picture is drawn. Kept apart from the API of the pages so the checks can run it alone.
// Written in TypeScript: `npm run build:ts` compiles it over utils/uploadActions.js.
const uploadsDb = require('../db/userUploads');
const plansDb = require('../db/userPlans');
const plans = require('./userPlans');
const images = require('./shopImages');
/** The version of the policy of the user. A new one is asked again to everybody who accepted an older one. */
exports.POLICY_VERSION = 1;
exports.MAX_UPLOAD_BYTES = 1_048_576;
const ID = /^\d{15,25}$/;
const REASONS = ['sexual', 'minor', 'violence', 'hate', 'illegal', 'private', 'copyright', 'quality', 'other'];
/** What the plan of a person allows for an own picture: none, a still one or an animated one (animated pictures are not supported yet, so they are still too). */
async function perkOf(userId) {
    const row = await plansDb.getPlan(userId).catch(() => null);
    const tier = row && row.active ? row.plan : 'free';
    return plans.PLAN_PERKS[tier]?.ownBackground ?? 'none';
}
async function state(userId) {
    const [perk, version, blocked, upload] = await Promise.all([perkOf(userId), uploadsDb.policyVersionOf(userId), uploadsDb.isBlocked(userId), uploadsDb.getState(userId)]);
    return { ok: true, allowed: perk !== 'none', perk, policyAccepted: version >= exports.POLICY_VERSION, policyVersion: exports.POLICY_VERSION, blocked, upload };
}
async function acceptPolicy(userId) {
    await uploadsDb.acceptPolicy(userId, exports.POLICY_VERSION);
    return { ok: true };
}
/** Receives a picture: it waits for review (nobody sees it until it is approved). */
async function submit(userId, bytes) {
    if (await uploadsDb.isBlocked(userId))
        return { ok: false, error: 'blocked' };
    if (await perkOf(userId) === 'none')
        return { ok: false, error: 'premium_required' };
    if ((await uploadsDb.policyVersionOf(userId)) < exports.POLICY_VERSION)
        return { ok: false, error: 'policy_required' };
    if (!Buffer.isBuffer(bytes) || bytes.length === 0)
        return { ok: false, error: 'bad_file' };
    if (bytes.length > exports.MAX_UPLOAD_BYTES)
        return { ok: false, error: 'too_big' };
    const done = await images.normalizeBanner(bytes);
    if (!done.ok)
        return { ok: false, error: done.error };
    await uploadsDb.setPending(userId, done.bytes);
    return { ok: true };
}
/** The picture that is drawn for a person: the approved one, or null. */
const approvedImage = (userId) => uploadsDb.approvedBytes(userId);
exports.approvedImage = approvedImage;
// ---- the team (the routes check that the person is the owner)
async function queue() {
    const [pending, blocked] = await Promise.all([uploadsDb.listPending(30), uploadsDb.listBlocked(50)]);
    return { ok: true, pending, blocked };
}
async function pendingFile(userId) { return ID.test(userId) ? uploadsDb.pendingBytes(userId) : null; }
/** `action`: approve, reject (with a reason; `block` also stops the person), takedown (removes what they have, with a reason; `block` also stops them) or unblock. */
async function review(adminId, body) {
    const person = typeof body.person === 'string' && ID.test(body.person) ? body.person : null;
    if (!person)
        return { ok: false, error: 'bad_person' };
    const action = body.action;
    const reason = REASONS.includes(body.reason) ? body.reason : 'other';
    if (action === 'approve')
        return (await uploadsDb.approve(person)) ? { ok: true } : { ok: false, error: 'nothing_pending' };
    if (action === 'unblock')
        return (await uploadsDb.unblock(person)) ? { ok: true } : { ok: false, error: 'not_blocked' };
    if (action === 'reject' || action === 'takedown') {
        // A picture with a minor is never kept: it is removed, the person is blocked, and the team has to report it as the law asks (nothing here sends it anywhere).
        const must = reason === 'minor';
        const did = action === 'reject' ? await uploadsDb.reject(person, reason) : await uploadsDb.takedown(person, reason);
        if (!did)
            return { ok: false, error: action === 'reject' ? 'nothing_pending' : 'nothing_to_remove' };
        if (must)
            await uploadsDb.takedown(person, reason);
        if (must || body.block === true)
            await uploadsDb.block(person, reason, adminId);
        return { ok: true, blocked: must || body.block === true };
    }
    return { ok: false, error: 'bad_request' };
}
