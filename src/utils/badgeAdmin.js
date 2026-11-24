"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saleStatus = saleStatus;
exports.list = list;
exports.save = save;
exports.setImage = setImage;
exports.setActive = setActive;
// i18n-ignore-file: the answers are codes; the editor of the website writes the words.
// What the editor of badges of the team does: list the badges with how each one stands (on sale, planned, ended, off sale, given by a rule) and how many people have it,
// save one, put its picture, take it off sale or put it back. Only the owner (the routes check it). Forgets the read badges after each change so the shop shows it at once.
// Written in TypeScript: `npm run build:ts` compiles it over utils/badgeAdmin.js.
const check = require('./customBadgeRules');
const customDb = require('../db/customBadges');
const registry = require('./badgeRegistry');
/** How a badge of the editor stands at a moment. */
function saleStatus(row, now = new Date()) {
    if (!row.active)
        return 'retired';
    if (row.grantRule)
        return 'rule';
    if (row.saleFrom && new Date(row.saleFrom).getTime() > now.getTime())
        return 'scheduled';
    if (row.saleUntil && new Date(row.saleUntil).getTime() <= now.getTime())
        return 'ended';
    return 'live';
}
async function list(now = new Date()) {
    const [rows, owners] = await Promise.all([customDb.listCustomBadges(), customDb.ownerCounts()]);
    return { badges: rows.filter((row) => !row.id.startsWith('own-')).map((row) => ({ ...row, status: saleStatus(row, now), owners: owners[row.id] ?? 0 })) };
}
async function save(userId, body) {
    const checked = check.checkBadgeInput(body);
    if (!checked.ok)
        return { ok: false, error: checked.error };
    const created = await customDb.saveCustomBadge(checked.value, userId);
    registry.invalidate();
    return { ok: true, created, id: checked.value.id };
}
async function setImage(id, bytes) {
    const checked = check.checkImage(bytes);
    if (!checked.ok)
        return { ok: false, error: checked.error };
    const found = await customDb.setCustomImage(id, bytes, checked.type);
    registry.invalidate();
    return found ? { ok: true } : { ok: false, error: 'not_found' };
}
async function setActive(id, active) {
    const found = await customDb.setBadgeActive(id, active);
    registry.invalidate();
    return found ? { ok: true } : { ok: false, error: 'not_found' };
}
