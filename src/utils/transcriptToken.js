const crypto = require('crypto');
const config = require('../config');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(input) {
  return base64url(crypto.createHmac('sha256', config.verifyTokenSecret).update(input).digest());
}

/**
 * Builds a signed, non-expiring token identifying one ticket, for the public
 * transcript viewer link. Unlike the /verify magic link (utils/verifyToken.js),
 * this is a shareable "view" link meant to work indefinitely for staff/opener
 * reference, not a one-time action — so there's no jti/expiry/redemption tracking,
 * just a signature over which ticket it grants access to.
 */
function createTranscriptToken({ ticketId, guildId }) {
  const payload = { tid: ticketId, gid: guildId };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verifies signature. Returns { ticketId, guildId } or null if invalid/tampered. */
function verifyTranscriptToken(token) {
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

  if (!payload.tid || !payload.gid) return null;
  return { ticketId: payload.tid, guildId: payload.gid };
}

module.exports = { createTranscriptToken, verifyTranscriptToken };
