// i18n-ignore-file: the answers are codes and numbers; the website writes the words.
// Giving the ceramos of a pack that was paid. Kept apart from the API of the pages so the checks can run it without the rest of the profile.
// Written in TypeScript: `npm run build:ts` compiles it over utils/coinPackActions.js.
const packs = require('./coinPacks') as typeof import('./coinPacks');
const walletDb = require('../db/ceramos') as typeof import('../db/ceramos');

/** Takes back the ceramos of an order the payment service refunded (once for each order id; what was already spent is not taken). */
export async function refund(orderId: string) {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(orderId)) return { ok: false as const, reason: 'bad_request' as const };
  const done = await walletDb.refundOnce(orderId);
  return done ? { ok: true as const, applied: true, took: done.took, coins: done.coins, balance: done.balance } : { ok: true as const, applied: false };
}

/** Gives the ceramos of a pack that was paid (the website calls it when the payment service says the order is paid). Once for each order id. */
export async function credit(userId: string, packId: string, orderId: string) {
  const pack = packs.packById(packId);
  if (!pack || !/^[A-Za-z0-9_-]{6,80}$/.test(orderId)) return { ok: false as const, reason: 'bad_request' as const };
  const done = await walletDb.giveOnce(userId, pack.coins, pack.id, orderId);
  return { ok: true as const, coins: pack.coins, balance: done.balance, applied: done.applied };
}
