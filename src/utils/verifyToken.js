const crypto = require('crypto');
const config = require('../config');

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h — long enough that a slow-to-check-DMs new member doesn't get locked out

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(input) {
  return base64url(crypto.createHmac('sha256', config.verifyTokenSecret).update(input).digest());
}

/**
 * Builds a signed, expiring token binding a Discord user to a guild for the
 * /verify web flow. `jti` is a random per-token id — the token itself stays
 * stateless (nothing is written to the DB at creation time), but it gives the
 * server something unique to mark as "already redeemed" so a link can't be
 * replayed indefinitely until its 24h expiry (see verification_redemptions).
 */
function createToken({ userId, guildId }, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const payload = { uid: userId, gid: guildId, jti: base64url(crypto.randomBytes(9)), exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verifies signature + expiry. Returns { userId, guildId, jti } or null if invalid/expired/tampered. */
function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  const expected = sign(payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload.uid || !payload.gid || !payload.jti || !payload.exp) return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) return null;

  return { userId: payload.uid, guildId: payload.gid, jti: payload.jti };
}

module.exports = { createToken, verifyToken };
