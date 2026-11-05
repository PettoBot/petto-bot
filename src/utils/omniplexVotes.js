// Votes for the bot on omniplex.gg, delivered as webhooks. Every request carries `X-Webhook-Signature: sha256=<hex>`, where the hex is
// the HMAC SHA-256 of the raw body keyed with the webhook secret. The body is an envelope `{ type, data, creator, targets, metadata }`;
// a vote is `type: "NEW_VOTE"` with `data: { votes, per_user, downvote, auto }`, `creator.id` the voter and `metadata.created_at` in seconds.
// The shape of the payload comes from the omniplex documentation and has not been checked against a real delivery, so everything
// here is read defensively: anything unexpected is ignored, nothing throws.
const crypto = require('node:crypto');

const VOTE_EVENT = 'NEW_VOTE';
const VOTE_HOURS = 12;
const SNOWFLAKE = /^\d{15,25}$/;
// A vote dated further ahead than this is taken to be a wrong clock and counted as cast now.
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** True when the signature header matches the raw body. Compared in constant time. */
function verifySignature({ secret, header, rawBody }) {
  if (!secret || !header || !Buffer.isBuffer(rawBody)) return false;
  const match = /^(?:sha256=)?([0-9a-f]{64})$/i.exec(String(header).trim());
  if (!match) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(match[1], 'hex'));
}

/** A time written as seconds (the documented form), milliseconds or an ISO date, in milliseconds; null when it is none of them. */
function readTime(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'object') return null;
  const number = Number(value);
  if (Number.isFinite(number)) {
    if (number <= 0) return null;
    // Nobody votes after the year 5138 counted in seconds, so a bigger number is milliseconds.
    const ms = number > 1e11 ? number : number * 1000;
    return Number.isFinite(new Date(ms).getTime()) ? ms : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * What an omniplex event is for Petto: `{ vote }` for a vote that counts, or `{ ignored: reason }` for anything else (a test, a
 * downvote, an automatic vote, another event, a payload that is not what was expected). The vote is in the shape Petto stores.
 */
function readEvent(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ignored: 'payload' };
  const type = typeof payload.type === 'string' ? payload.type.trim().toUpperCase() : '';
  if (type !== VOTE_EVENT) return { ignored: 'type' };
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const flag = (value) => value === true || value === 'true';
  if (flag(metadata.test)) return { ignored: 'test' };
  if (flag(data.downvote)) return { ignored: 'downvote' };
  if (flag(data.auto)) return { ignored: 'auto' };
  const userId = String(payload.creator?.id ?? '');
  if (!SNOWFLAKE.test(userId)) return { ignored: 'voter' };

  const createdAt = readTime(metadata.created_at);
  const votedMs = createdAt !== null && createdAt <= nowMs + FUTURE_TOLERANCE_MS ? createdAt : nowMs;
  // The payload has no vote id: the voter and the moment make one, so a delivery sent again is the same vote.
  const raw = metadata.created_at;
  const moment = (typeof raw === 'number' && Number.isFinite(raw)) || (typeof raw === 'string' && raw.trim())
    ? String(raw).trim().slice(0, 40)
    : `t${Math.floor(nowMs / 60_000)}`;
  return {
    vote: {
      source: 'omniplex',
      voteId: `${userId}:${moment}`,
      userId,
      weight: 1,
      votedAt: new Date(votedMs).toISOString(),
      expiresAt: new Date(votedMs + VOTE_HOURS * 60 * 60 * 1000).toISOString(),
    },
  };
}

/** The vote of a `NEW_VOTE` event in the shape Petto stores, or null for anything else. */
function parseVote(payload, nowMs = Date.now()) {
  return readEvent(payload, nowMs).vote ?? null;
}

module.exports = { verifySignature, readEvent, parseVote, VOTE_EVENT };
