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

/** The same text compared in constant time, whatever its length (both sides are hashed first). */
function sameText(a, b) {
  const hash = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

/**
 * Checks a delivery whichever way the webhook was saved on Omniplex. The way is named by `X-Webhook-Protocol` (`hmac-sha256`, the
 * recommended one; `simple-auth`: the header `Authorization` is the secret itself; `splashtail`: the older signed and encrypted body, read
 * as the Omniplex SDK reads it). Without that header the way is guessed from the headers that came. Returns `{ ok, protocol, payload }`
 * (`payload` is the body read as JSON, the decrypted one for splashtail, or null when it is not JSON) or `{ ok: false, protocol, reason }`.
 * `header(name)` reads a request header.
 */
function checkDelivery({ secret, header, rawBody }) {
  const named = String(header('x-webhook-protocol') ?? '').trim().toLowerCase();
  const protocol = named || (header('x-webhook-signature') ? 'hmac-sha256' : (header('authorization') ? 'simple-auth' : ''));
  const fail = (reason) => ({ ok: false, protocol: protocol || 'none', reason });
  if (!secret) return fail('no_secret');
  if (!Buffer.isBuffer(rawBody)) return fail('no_body');
  const readJson = (buffer) => { try { return JSON.parse(buffer.toString('utf8')); } catch { return null; } };

  if (protocol === 'hmac-sha256') {
    if (!header('x-webhook-signature')) return fail('no_signature');
    if (!verifySignature({ secret, header: header('x-webhook-signature'), rawBody })) return fail('bad_signature');
    return { ok: true, protocol, payload: readJson(rawBody) };
  }
  if (protocol === 'simple-auth') {
    const sent = String(header('authorization') ?? '').trim().replace(/^Bearer\s+/i, '');
    if (!sent) return fail('no_authorization');
    if (!sameText(sent, secret)) return fail('bad_authorization');
    return { ok: true, protocol, payload: readJson(rawBody) };
  }
  if (protocol === 'splashtail') {
    const nonce = String(header('x-webhook-nonce') ?? '');
    const signature = String(header('x-webhook-signature') ?? '').trim().toLowerCase();
    if (!nonce || !signature) return fail('no_signature');
    const inner = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    const expected = crypto.createHmac('sha512', nonce).update(inner).digest('hex');
    if (!sameText(signature, expected)) return fail('bad_signature');
    try {
      const body = Buffer.from(rawBody.toString('utf8').trim(), 'hex');
      if (body.length < 28) return { ok: true, protocol, payload: null };
      const key = crypto.createHash('sha256').update(secret + nonce).digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
      decipher.setAuthTag(body.subarray(body.length - 16));
      const plain = Buffer.concat([decipher.update(body.subarray(12, body.length - 16)), decipher.final()]);
      return { ok: true, protocol, payload: readJson(plain) };
    } catch {
      return { ok: true, protocol, payload: null };
    }
  }
  return fail(protocol ? 'unsupported_protocol' : 'no_credentials');
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

module.exports = { verifySignature, checkDelivery, readEvent, parseVote, VOTE_EVENT };
