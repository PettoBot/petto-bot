// i18n-ignore-file: the answers are codes and numbers; the website writes the words.
// The read-only API: keys (made, listed, removed) and what a key can read. A key can only read the ceramos of its own person; nothing it does changes anything.
// Written in TypeScript: `npm run build:ts` compiles it over utils/publicApiActions.js.
const crypto = require('node:crypto') as typeof import('node:crypto');
const keysDb = require('../db/apiKeys') as typeof import('../db/apiKeys');
const walletDb = require('../db/ceramos') as typeof import('../db/ceramos');
const plansDb = require('../db/userPlans') as typeof import('../db/userPlans');
const rules = require('./ceramos') as typeof import('./ceramos');
const packs = require('./coinPacks') as typeof import('./coinPacks');

export const KEY_PREFIX = 'petto_';
const KEY_SHAPE = /^petto_[A-Za-z0-9_-]{43}$/;

export const hashKey = (key: string): string => crypto.createHash('sha256').update(key).digest('hex');
export const looksLikeKey = (key: unknown): key is string => typeof key === 'string' && KEY_SHAPE.test(key);

export async function list(userId: string) { return { ok: true as const, keys: await keysDb.listKeys(userId), max: keysDb.MAX_KEYS }; }

/** Makes a key. It is returned once; only its hash is saved. */
export async function create(userId: string, body: Record<string, unknown>) {
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 40) : '';
  const key = `${KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const id = await keysDb.addKey(userId, hashKey(key), label);
  return id === null ? { ok: false as const, error: 'too_many' as const } : { ok: true as const, id, key };
}

export async function remove(userId: string, body: Record<string, unknown>) {
  const id = typeof body.id === 'number' && Number.isInteger(body.id) ? body.id : 0;
  if (id < 1) return { ok: false as const, error: 'bad_request' as const };
  return (await keysDb.removeKey(userId, id)) ? { ok: true as const } : { ok: false as const, error: 'not_found' as const };
}

const calls = new Map<string, number[]>();
/** 60 reads a minute for each key. */
function tooMany(hash: string): boolean {
  const now = Date.now();
  const recent = (calls.get(hash) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 60) { calls.set(hash, recent); return true; }
  recent.push(now); calls.set(hash, recent);
  if (calls.size > 5000) for (const [k, v] of calls) if (!v.some((at) => now - at < 60_000)) calls.delete(k);
  return false;
}

/** What a key reads. `what` is `me` (balance and plan) or `movements` (the last ones). */
export async function read(key: unknown, what: 'me' | 'movements') {
  if (!looksLikeKey(key)) return { ok: false as const, error: 'bad_key' as const };
  const hash = hashKey(key);
  if (tooMany(hash)) return { ok: false as const, error: 'rate_limited' as const };
  const userId = await keysDb.userOfKey(hash);
  if (!userId) return { ok: false as const, error: 'bad_key' as const };
  if (what === 'movements') {
    const moves = await walletDb.lastMovements(userId, 50);
    return { ok: true as const, movements: moves.map((move) => ({ amount: move.delta, reason: move.reason, ref: move.ref, at: move.createdAt.toISOString() })) };
  }
  const [wallet, plan] = await Promise.all([walletDb.getWallet(userId), plansDb.getPlan(userId).catch(() => null)]);
  const tier = plan && plan.active ? plan.plan : 'free';
  return { ok: true as const, userId, balance: wallet.balance, plan: tier, dailyAmount: rules.dailyAmount(tier as never), planEndsAt: plan && plan.active ? plan.endsAt : null };
}

/** What anyone can read: the packs of ceramos and the daily ceramos of each plan. */
export function publicInfo() {
  return { ok: true as const, packs: packs.COIN_PACKS.map((pack) => ({ id: pack.id, ceramos: pack.coins, priceUsd: pack.price })), daily: { free: rules.dailyAmount('free' as never), bronze: rules.dailyAmount('bronze' as never), silver: rules.dailyAmount('silver' as never), gold: rules.dailyAmount('gold' as never) } };
}
