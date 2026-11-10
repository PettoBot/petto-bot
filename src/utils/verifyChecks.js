// i18n-ignore-file: the rules of the verification checks; the texts people read are in the catalogs (verify.*, web.verifyApi.*)
// The checks a server can ask on top of the captcha when a member verifies (settings `verification_config.checks`):
//   tor      the member connects through the Tor network (the public list of exit nodes, utils/torList.js)
//   alt      the connection (IP) or the email was already used by another member of the server, or by one who was banned
//   account  the Discord account is younger than N days, has no avatar, or is flagged by Discord (spammer, quarantined)
//   email    a code sent to the member's email has to be typed (utils/emailCode.js, utils/resend.js); by default only the providers everybody knows (Gmail, Outlook, Yahoo, iCloud, Proton...) and no `+tag`; the server can allow or refuse domains
// Each of the first three is `off`, `warn` (the member verifies and the staff is told in the verification log) or `block` (the member is not verified).
// The email is `required` or not; a domain that is not accepted is told to the member, who can use another address.
const crypto = require('node:crypto');
const { UserFlags } = require('discord.js');
const config = require('../config');

const MODES = ['off', 'warn', 'block'];
const MAX_DOMAINS = 50;
const MAX_AGE_DAYS = 365;

const DEFAULT_CHECKS = Object.freeze({
  tor: 'off',
  alt: 'off',
  account: Object.freeze({ mode: 'off', min_age_days: 0, no_avatar: false, flagged: true }),
  email: Object.freeze({ required: false, common_only: true, block_disposable: true, allowed_domains: Object.freeze([]), blocked_domains: Object.freeze([]) }),
});

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A list of domains as the settings keep it: lower case, valid, no `@`, no duplicates, at most 50. Takes an array or a text with commas, spaces or lines. */
function domainList(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/);
  const out = [];
  for (const part of parts) {
    const domain = String(part ?? '').trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (DOMAIN_RE.test(domain) && !out.includes(domain)) out.push(domain);
    if (out.length >= MAX_DOMAINS) break;
  }
  return out;
}

const modeOf = (value, fallback = 'off') => (MODES.includes(value) ? value : fallback);

/** The settings of the checks of a server: anything that is missing or wrong is the default (everything off), so an old row or a bad value never blocks anybody. */
function normalizeChecks(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const account = source.account && typeof source.account === 'object' ? source.account : {};
  const email = source.email && typeof source.email === 'object' ? source.email : {};
  const days = Math.floor(Number(account.min_age_days));
  return {
    tor: modeOf(source.tor),
    alt: modeOf(source.alt),
    account: {
      mode: modeOf(account.mode),
      min_age_days: Number.isFinite(days) ? Math.min(MAX_AGE_DAYS, Math.max(0, days)) : 0,
      no_avatar: account.no_avatar === true,
      flagged: account.flagged !== false,
    },
    email: {
      required: email.required === true,
      common_only: email.common_only !== false,
      block_disposable: email.block_disposable !== false,
      allowed_domains: domainList(email.allowed_domains),
      blocked_domains: domainList(email.blocked_domains),
    },
  };
}

/** Whether any check is on. */
const anyCheck = (checks) => checks.tor !== 'off' || checks.alt !== 'off' || checks.account.mode !== 'off' || checks.email.required;
/** Whether the check needs the web page (the connection or the email): the letters inside Discord have neither. */
const needsWebPage = (checks) => checks.tor !== 'off' || checks.alt !== 'off' || checks.email.required;

/** An IP as it is compared: lower case, without the IPv4-in-IPv6 prefix (`::ffff:1.2.3.4`), or null when it is not one. */
function normalizeIp(value) {
  let ip = String(value ?? '').trim().toLowerCase();
  if (!ip) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) ip = mapped[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return ip.split('.').every((part) => Number(part) <= 255) ? ip : null;
  return /^[0-9a-f:]+$/.test(ip) && ip.includes(':') ? ip : null;
}

/** The IP of the visitor. Behind the Cloudflare tunnel of the bot the header of Cloudflare has the real one; without the tunnel nothing but the connection is trusted. */
function clientIp(req) {
  const fromCloudflare = config.cloudflareTunnelToken ? req.get?.('cf-connecting-ip') : null;
  return normalizeIp(fromCloudflare) ?? normalizeIp(req.ip);
}

/** A keyed hash of what identifies a connection or an email in one server, so the signals can be compared and nothing can be read back from them. Null when there is no secret. */
function signalHash(guildId, kind, value) {
  const secret = config.verifyTokenSecret;
  if (!secret || !value) return null;
  return crypto.createHmac('sha256', secret).update(`${kind}:${guildId}:${value}`).digest('hex').slice(0, 40);
}

/** Whether the flags of a user have a bit. The bit of `Quarantined` is the 44th: discord.js `has` works with 32 bits and says no, so it is read as a big number. */
function hasFlag(flags, bit) {
  try { return (BigInt(flags.bitfield) & BigInt(bit)) !== 0n; } catch { return false; }
}

/**
 * What the checks of the account find. `settings` is the normalized `checks.account`. Returns the list of reasons (each `{ code, ... }`).
 * `flags` is the result of `user.fetchFlags()` (or null when Discord did not answer: the check of the flags is then skipped).
 */
function accountReasons(user, rules, { flags = null, now = Date.now() } = {}) {
  const reasons = [];
  if (rules.mode === 'off') return reasons;
  if (rules.min_age_days > 0) {
    const days = (now - user.createdTimestamp) / 86_400_000;
    if (days < rules.min_age_days) reasons.push({ code: 'young', days: Math.floor(days), min: rules.min_age_days });
  }
  if (rules.no_avatar && !user.avatar) reasons.push({ code: 'noAvatar' });
  if (rules.flagged && flags && (hasFlag(flags, UserFlags.Spammer) || hasFlag(flags, UserFlags.Quarantined))) reasons.push({ code: 'flagged' });
  return reasons;
}

/**
 * Runs the checks of a server on a member. Returns `{ block: [reasons], warn: [reasons], alts }`: a reason is `{ check, code, ... }`, in `block` when the
 * check of that reason is on `block` and in `warn` when it is on `warn`. `deps` (tests replace them): `torHas(ip)`, `signals.findMatches(...)`, `banned(guild, userId)`, `flagsOf(user)`.
 * `ip` and `emailHash` are null when the member verifies inside Discord (no web page): the checks of those are then skipped.
 */
async function evaluate({ checks, guild, member, ip = null, emailHash = null, deps = {} }) {
  const out = { block: [], warn: [], alts: [] };
  const put = (mode, reasons) => { for (const reason of reasons) (mode === 'block' ? out.block : out.warn).push(reason); };

  if (checks.tor !== 'off' && ip) {
    const torHas = deps.torHas ?? require('./torList').isExit;
    if (torHas(ip)) put(checks.tor, [{ check: 'tor', code: 'tor' }]);
  }

  if (checks.account.mode !== 'off') {
    const flagsOf = deps.flagsOf ?? ((user) => user.fetchFlags().catch(() => null));
    const flags = checks.account.flagged ? await flagsOf(member.user) : null;
    put(checks.account.mode, accountReasons(member.user, checks.account, { flags }).map((reason) => ({ check: 'account', ...reason })));
  }

  if (checks.alt !== 'off') {
    const ipHash = signalHash(guild.id, 'ip', ip);
    if (ipHash || emailHash) {
      const store = deps.signals ?? require('../db/verificationSignals');
      const matches = await store.findMatches(guild.id, member.id, { ipHash, emailHash }).catch(() => []);
      const banned = deps.banned ?? ((g, id) => g.bans.fetch({ user: id, force: false }).then(() => true).catch(() => false));
      for (const match of matches.slice(0, 5)) {
        out.alts.push({ userId: match.user_id, by: match.by, banned: await banned(guild, match.user_id) });
      }
      if (out.alts.length) put(checks.alt, [{ check: 'alt', code: 'alt', alts: out.alts }]);
    }
  }
  return out;
}

/**
 * The checks after a change asked from the command (`!verify checks <check> <mode> ...`): `input` is `{ check, mode, minAge, avatar, flagged, common, disposable, allow, deny }`.
 * `{ ok: true, checks }`, or `{ ok: false }` when the check or the mode is not valid for it. `allow` and `deny` are texts of domains, or `none` to empty the list.
 */
function applyChange(current, input) {
  const next = normalizeChecks(current);
  const mode = String(input.mode ?? '').toLowerCase() || null;
  const list = (value) => (String(value).trim().toLowerCase() === 'none' ? [] : domainList(value));
  switch (input.check) {
    case 'tor':
    case 'alt':
      if (!MODES.includes(mode)) return { ok: false };
      next[input.check] = mode;
      return { ok: true, checks: next };
    case 'account':
      if (mode && !MODES.includes(mode)) return { ok: false };
      if (mode) next.account.mode = mode;
      if (Number.isInteger(input.minAge)) next.account.min_age_days = Math.min(MAX_AGE_DAYS, Math.max(0, input.minAge));
      if (typeof input.avatar === 'boolean') next.account.no_avatar = input.avatar;
      if (typeof input.flagged === 'boolean') next.account.flagged = input.flagged;
      return { ok: true, checks: next };
    case 'email':
      if (mode && !['on', 'off'].includes(mode)) return { ok: false };
      if (mode) next.email.required = mode === 'on';
      if (typeof input.common === 'boolean') next.email.common_only = input.common;
      if (typeof input.disposable === 'boolean') next.email.block_disposable = input.disposable;
      if (input.allow != null) next.email.allowed_domains = list(input.allow);
      if (input.deny != null) next.email.blocked_domains = list(input.deny);
      return { ok: true, checks: next };
    default:
      return { ok: false };
  }
}

module.exports = { applyChange, MODES, DEFAULT_CHECKS, normalizeChecks, domainList, anyCheck, needsWebPage, normalizeIp, clientIp, signalHash, accountReasons, evaluate };
