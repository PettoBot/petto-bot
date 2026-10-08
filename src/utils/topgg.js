// Votes for the bot on top.gg, delivered as v1 webhooks (https://docs.top.gg/webhooks/overview). Every request carries
// `x-topgg-signature: t=<unix seconds>,v1=<hex>`, where the hex is HMAC SHA-256 of `<t>.<raw body>` with the webhook secret (`whs_...`).
const crypto = require('node:crypto');

const TOLERANCE_SECONDS = 300;

/** True when the signature header matches the raw body and the timestamp is recent. */
function verifySignature({ secret, header, rawBody, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = TOLERANCE_SECONDS }) {
  if (!secret || !header || !Buffer.isBuffer(rawBody)) return false;
  const parts = Object.fromEntries(String(header).split(',').map((piece) => {
    const index = piece.indexOf('=');
    return index === -1 ? [piece.trim(), ''] : [piece.slice(0, index).trim(), piece.slice(index + 1).trim()];
  }));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  if (!/^[0-9a-f]{64}$/i.test(parts.v1 ?? '')) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.`).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'));
}

const SNOWFLAKE = /^\d{15,25}$/;

/** The vote of a `vote.create` event in the shape Petto stores, or null for any other event or a malformed one. */
function parseVote(payload) {
  if (!payload || payload.type !== 'vote.create' || !payload.data) return null;
  const { id, weight, created_at: createdAt, expires_at: expiresAt, user } = payload.data;
  const userId = String(user?.platform_id ?? '');
  if (!id || !SNOWFLAKE.test(userId)) return null;
  const date = (value) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); };
  const count = Number(weight);
  return {
    source: 'topgg',
    voteId: String(id).slice(0, 64),
    userId,
    weight: Number.isInteger(count) && count >= 1 && count <= 10 ? count : 1,
    votedAt: date(createdAt) ?? new Date().toISOString(),
    expiresAt: date(expiresAt),
  };
}

module.exports = { verifySignature, parseVote, TOLERANCE_SECONDS };
