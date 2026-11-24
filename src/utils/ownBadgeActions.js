"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_BADGE_SIDE = exports.BADGE_SIDE = exports.MAX_BADGE_UPLOAD = exports.MAX_SLOTS = void 0;
exports.slotsOf = slotsOf;
exports.state = state;
exports.submit = submit;
exports.remove = remove;
exports.queue = queue;
exports.pendingFile = pendingFile;
exports.review = review;
// i18n-ignore-file: the answers are codes; the website writes the words.
// Own badges: with a plan a person makes their own badges (Bronze 1, Silver 2, Gold 4 — a name and a picture). They go through the same policy, block and detector as the own
// pictures and wait for the team; when one is approved it becomes a badge of the editor that is not for sale, and its maker gets it. Kept apart from the API of the pages so the checks can run it alone.
// Written in TypeScript: `npm run build:ts` compiles it over utils/ownBadgeActions.js.
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ownDb = require('../db/userOwnBadges');
const uploadsDb = require('../db/userUploads');
const plans = require('./userPlans');
const uploads = require('./uploadActions');
const detector = require('./imageScreen');
const gifs = require('../imgutils/gif');
const registry = require('./badgeRegistry');
exports.MAX_SLOTS = 4;
exports.MAX_BADGE_UPLOAD = 524_288;
exports.BADGE_SIDE = 256;
exports.MIN_BADGE_SIDE = 64;
const ID = /^\d{15,25}$/;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.'!&-]{1,23}$/u;
/** How many own badges the plan of a person lets them have. */
async function slotsOf(userId) {
    const tier = await uploads.planTier(userId);
    return plans.PLAN_PERKS[tier]?.ownBadges ?? 0;
}
const slotOf = (value) => { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= exports.MAX_SLOTS ? n : null; };
async function state(userId) {
    const [slots, version, blocked, approved, pending] = await Promise.all([slotsOf(userId), uploadsDb.policyVersionOf(userId), uploadsDb.isBlocked(userId), ownDb.approvedOf(userId), ownDb.pendingOf(userId)]);
    const items = [];
    for (let slot = 1; slot <= exports.MAX_SLOTS; slot += 1) {
        const have = approved.find((row) => row.slot === slot) ?? null;
        const waiting = pending.find((row) => row.slot === slot) ?? null;
        // A slot above what the plan allows now (the plan ended) is shown but cannot be changed.
        if (slot > slots && !have && !waiting)
            continue;
        items.push({ slot, locked: slot > slots, approved: have ? { id: have.id, name: have.name } : null, pending: waiting ? { name: waiting.name } : null });
    }
    return { ok: true, slots, policyAccepted: version >= uploads.POLICY_VERSION, policyVersion: uploads.POLICY_VERSION, blocked, items };
}
/** A picture made square (256 x 256) as a PNG, from a PNG, JPEG or WebP (a GIF is not accepted: the badges do not move). */
async function squareOf(bytes) {
    if (gifs.isGif(bytes))
        return { ok: false, error: 'bad_file' };
    let image;
    try {
        image = await loadImage(bytes);
    }
    catch {
        return { ok: false, error: 'bad_file' };
    }
    if (image.width < exports.MIN_BADGE_SIDE || image.height < exports.MIN_BADGE_SIDE)
        return { ok: false, error: 'file_too_small' };
    const canvas = createCanvas(exports.BADGE_SIDE, exports.BADGE_SIDE);
    const side = Math.min(image.width, image.height);
    canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, exports.BADGE_SIDE, exports.BADGE_SIDE);
    const png = canvas.toBuffer('image/png');
    return png.length > 262_144 ? { ok: false, error: 'too_big' } : { ok: true, png };
}
/** Receives a badge: `slot`, `name` and the picture. It waits for review (nobody sees it until it is approved). */
async function submit(userId, input, bytes) {
    if (await uploadsDb.isBlocked(userId))
        return { ok: false, error: 'blocked' };
    const slot = slotOf(input.slot);
    if (!slot)
        return { ok: false, error: 'bad_slot' };
    const allowed = await slotsOf(userId);
    if (allowed === 0)
        return { ok: false, error: 'premium_required' };
    if (slot > allowed)
        return { ok: false, error: 'slot_locked' };
    if ((await uploadsDb.policyVersionOf(userId)) < uploads.POLICY_VERSION)
        return { ok: false, error: 'policy_required' };
    const name = typeof input.name === 'string' ? input.name.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
    if (!NAME.test(name))
        return { ok: false, error: 'bad_name' };
    const file = require('./customBadgeRules').asBytes(bytes);
    if (!file || file.length === 0)
        return { ok: false, error: 'bad_file' };
    if (file.length > exports.MAX_BADGE_UPLOAD)
        return { ok: false, error: 'too_big' };
    const done = await squareOf(file);
    if (!done.ok)
        return { ok: false, error: done.error };
    const png = done.png;
    const verdict = await detector.screen(png, fetch, 'image/png');
    if (verdict.checked && verdict.minor) {
        await uploadsDb.block(userId, 'minor', 'detector');
        return { ok: false, error: 'blocked' };
    }
    if (verdict.checked && verdict.reasons.length)
        return { ok: false, error: 'detector', reasons: verdict.reasons };
    await ownDb.setPending(userId, slot, name, png, verdict.checked);
    return { ok: true };
}
/** The person takes a badge of theirs away (the waiting one, the approved one, or both). */
async function remove(userId, input) {
    const slot = slotOf(input.slot);
    if (!slot)
        return { ok: false, error: 'bad_slot' };
    const [waiting, had] = [await ownDb.removePending(userId, slot), await ownDb.removeApproved(userId, slot)];
    if (had)
        registry.invalidate();
    return waiting || had ? { ok: true } : { ok: false, error: 'nothing_to_remove' };
}
// ---- the team (the routes check that the person is the owner)
async function queue() { return { ok: true, pending: await ownDb.listPending(30) }; }
async function pendingFile(userId, slot) { const n = slotOf(slot); return ID.test(userId) && n ? ownDb.pendingImage(userId, n) : null; }
/** `action`: approve, reject (with a reason; `block` also stops the person) or takedown (removes the approved badge, with a reason; `block` also stops them). */
async function review(adminId, body) {
    const person = typeof body.person === 'string' && ID.test(body.person) ? body.person : null;
    const slot = slotOf(body.slot);
    if (!person || !slot)
        return { ok: false, error: 'bad_person' };
    const reason = uploads.REASONS.includes(body.reason) ? body.reason : 'other';
    if (body.action === 'approve') {
        const waiting = await ownDb.take(person, slot);
        if (!waiting)
            return { ok: false, error: 'nothing_pending' };
        await ownDb.approve(person, slot, waiting.name, waiting.image);
        registry.invalidate();
        return { ok: true };
    }
    if (body.action === 'reject' || body.action === 'takedown') {
        const must = reason === 'minor';
        const did = body.action === 'reject' ? Boolean(await ownDb.take(person, slot)) : await ownDb.removeApproved(person, slot);
        if (!did)
            return { ok: false, error: body.action === 'reject' ? 'nothing_pending' : 'nothing_to_remove' };
        if (body.action === 'takedown')
            registry.invalidate();
        if (must || body.block === true)
            await uploadsDb.block(person, reason, adminId);
        return { ok: true, blocked: must || body.block === true };
    }
    return { ok: false, error: 'bad_request' };
}
