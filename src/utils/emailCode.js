// i18n-ignore-file: the codes sent to the email of a member who verifies; the texts people read are in the catalogs
// The code of the email check: six digits, valid ten minutes, five tries, one new code every 45 seconds and three in ten minutes for each verification link.
// Everything is in memory and nothing keeps the email: the code is kept as a hash, and once it is typed the member only has "confirmed" (for half an hour,
// to press the button of the page). If the bot restarts in the middle, the member asks for a new code.
const crypto = require('node:crypto');

const CODE_TTL_MS = 10 * 60_000;
const CONFIRMED_TTL_MS = 30 * 60_000;
const MAX_TRIES = 5;
const COOLDOWN_MS = 45_000;
const MAX_SENDS = 3;
const SEND_WINDOW_MS = 10 * 60_000;
const MAX_ENTRIES = 20_000;
const MAX_PER_ADDRESS = 3; // codes sent to one address in an hour, whoever asks: nobody can use Petto to fill an inbox
const ADDRESS_WINDOW_MS = 60 * 60_000;

const salt = crypto.randomBytes(16);
const entries = new Map(); // jti -> { email, hash, expires, tries, sends: [time], confirmed: { email, until } | null }
const addresses = new Map(); // keyed hash of an address -> [time]

const digest = (code) => crypto.createHash('sha256').update(salt).update(String(code)).digest();

function sweep(now) {
  if (addresses.size >= MAX_ENTRIES) addresses.clear();
  if (entries.size < MAX_ENTRIES) return;
  for (const [jti, entry] of entries) if (entry.expires < now && (!entry.confirmed || entry.confirmed.until < now)) entries.delete(jti);
  if (entries.size >= MAX_ENTRIES) entries.clear();
}

/** A new code for a verification link and an email. `{ ok: true, code }` or `{ ok: false, reason: 'cooldown' | 'limit', waitMs }`. */
function issue(jti, email, now = Date.now()) {
  sweep(now);
  const entry = entries.get(jti) ?? { email: null, hash: null, expires: 0, tries: 0, sends: [], confirmed: null };
  entry.sends = entry.sends.filter((time) => now - time < SEND_WINDOW_MS);
  const last = entry.sends.at(-1);
  if (last && now - last < COOLDOWN_MS) return { ok: false, reason: 'cooldown', waitMs: COOLDOWN_MS - (now - last) };
  if (entry.sends.length >= MAX_SENDS) return { ok: false, reason: 'limit', waitMs: SEND_WINDOW_MS - (now - entry.sends[0]) };
  const addressKey = digest(`address:${email}`).toString('hex');
  const recent = (addresses.get(addressKey) ?? []).filter((time) => now - time < ADDRESS_WINDOW_MS);
  if (recent.length >= MAX_PER_ADDRESS) return { ok: false, reason: 'limit', waitMs: ADDRESS_WINDOW_MS - (now - recent[0]) };
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  Object.assign(entry, { email, hash: digest(code), expires: now + CODE_TTL_MS, tries: 0, confirmed: null });
  entry.sends.push(now);
  recent.push(now);
  addresses.set(addressKey, recent);
  entries.set(jti, entry);
  return { ok: true, code };
}

/** The code the member typed. `{ ok: true, email }`, or `{ ok: false, reason: 'none' | 'expired' | 'wrong' | 'locked' }`. */
function confirm(jti, typed, now = Date.now()) {
  const entry = entries.get(jti);
  if (!entry || !entry.hash) return { ok: false, reason: 'none' };
  if (entry.expires < now) return { ok: false, reason: 'expired' };
  if (entry.tries >= MAX_TRIES) return { ok: false, reason: 'locked' };
  entry.tries += 1;
  const given = digest(String(typed ?? '').replace(/\D/g, ''));
  if (!crypto.timingSafeEqual(given, entry.hash)) return { ok: false, reason: entry.tries >= MAX_TRIES ? 'locked' : 'wrong' };
  entry.confirmed = { email: entry.email, until: now + CONFIRMED_TTL_MS };
  entry.hash = null;
  return { ok: true, email: entry.email };
}

/** The email this verification link confirmed (it is still valid for a while), or null. */
function confirmedEmail(jti, now = Date.now()) {
  const confirmed = entries.get(jti)?.confirmed;
  return confirmed && confirmed.until >= now ? confirmed.email : null;
}

const forget = (jti) => { entries.delete(jti); };
const reset = () => { entries.clear(); addresses.clear(); };

module.exports = { issue, confirm, confirmedEmail, forget, reset, CODE_TTL_MS, COOLDOWN_MS, MAX_TRIES, MAX_SENDS, MAX_PER_ADDRESS };
