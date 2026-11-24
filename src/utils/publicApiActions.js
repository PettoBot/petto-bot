"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksLikeKey = exports.hashKey = exports.KEY_PREFIX = void 0;
exports.list = list;
exports.create = create;
exports.remove = remove;
exports.read = read;
exports.publicInfo = publicInfo;
// i18n-ignore-file: the answers are codes and numbers; the website writes the words.
// The read-only API: keys (made, listed, removed) and what a key can read. A key can only read the ceramos of its own person; nothing it does changes anything.
// Written in TypeScript: `npm run build:ts` compiles it over utils/publicApiActions.js.
const crypto = require('node:crypto');
const keysDb = require('../db/apiKeys');
const walletDb = require('../db/ceramos');
const plansDb = require('../db/userPlans');
const rules = require('./ceramos');
const packs = require('./coinPacks');
exports.KEY_PREFIX = 'petto_';
const KEY_SHAPE = /^petto_[A-Za-z0-9_-]{43}$/;
const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');
exports.hashKey = hashKey;
const looksLikeKey = (key) => typeof key === 'string' && KEY_SHAPE.test(key);
exports.looksLikeKey = looksLikeKey;
async function list(userId) { return { ok: true, keys: await keysDb.listKeys(userId), max: keysDb.MAX_KEYS }; }
/** Makes a key. It is returned once; only its hash is saved. */
async function create(userId, body) {
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 40) : '';
    const key = `${exports.KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
    const id = await keysDb.addKey(userId, (0, exports.hashKey)(key), label);
    return id === null ? { ok: false, error: 'too_many' } : { ok: true, id, key };
}
async function remove(userId, body) {
    const id = typeof body.id === 'number' && Number.isInteger(body.id) ? body.id : 0;
    if (id < 1)
        return { ok: false, error: 'bad_request' };
    return (await keysDb.removeKey(userId, id)) ? { ok: true } : { ok: false, error: 'not_found' };
}
const calls = new Map();
/** 60 reads a minute for each key. */
function tooMany(hash) {
    const now = Date.now();
    const recent = (calls.get(hash) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= 60) {
        calls.set(hash, recent);
        return true;
    }
    recent.push(now);
    calls.set(hash, recent);
    if (calls.size > 5000)
        for (const [k, v] of calls)
            if (!v.some((at) => now - at < 60_000))
                calls.delete(k);
    return false;
}
/** What a key reads. `what` is `me` (balance and plan) or `movements` (the last ones). */
async function read(key, what) {
    if (!(0, exports.looksLikeKey)(key))
        return { ok: false, error: 'bad_key' };
    const hash = (0, exports.hashKey)(key);
    if (tooMany(hash))
        return { ok: false, error: 'rate_limited' };
    const userId = await keysDb.userOfKey(hash);
    if (!userId)
        return { ok: false, error: 'bad_key' };
    if (what === 'movements') {
        const moves = await walletDb.lastMovements(userId, 50);
        return { ok: true, movements: moves.map((move) => ({ amount: move.delta, reason: move.reason, ref: move.ref, at: move.createdAt.toISOString() })) };
    }
    const [wallet, plan] = await Promise.all([walletDb.getWallet(userId), plansDb.getPlan(userId).catch(() => null)]);
    const tier = plan && plan.active ? plan.plan : 'free';
    return { ok: true, userId, balance: wallet.balance, plan: tier, dailyAmount: rules.dailyAmount(tier), planEndsAt: plan && plan.active ? plan.endsAt : null };
}
/** What anyone can read: the packs of ceramos and the daily ceramos of each plan. */
function publicInfo() {
    return { ok: true, packs: packs.COIN_PACKS.map((pack) => ({ id: pack.id, ceramos: pack.coins, priceUsd: pack.price })), daily: { free: rules.dailyAmount('free'), bronze: rules.dailyAmount('bronze'), silver: rules.dailyAmount('silver'), gold: rules.dailyAmount('gold') } };
}
