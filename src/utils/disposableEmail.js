// i18n-ignore-file: the rules for the email of the verification (utils/emailCode.js); the answers people read are in the catalogs
// What an email is worth for the verification: it has to look like one, its domain can be one of the throwaway ones (the list of
// github.com/disposable-email-domains/disposable-email-domains, public domain, in src/data), and the server can allow or refuse domains.
const fs = require('node:fs');
const path = require('node:path');

const MAX_EMAIL = 254;
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63})$/;
const GOOGLE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

let disposable = null;
function list() {
  if (!disposable) {
    disposable = new Set(fs.readFileSync(path.join(__dirname, '..', 'data', 'disposable-email-domains.txt'), 'utf8').split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean));
  }
  return disposable;
}

/** Whether a domain, or a domain it is a subdomain of, is `domain` in `domains` (a Set or an array). */
function inList(domain, domains) {
  const set = domains instanceof Set ? domains : new Set(domains);
  const parts = domain.split('.');
  for (let i = 0; i <= parts.length - 2; i += 1) if (set.has(parts.slice(i).join('.'))) return true;
  return false;
}

/**
 * The email as it is compared. `{ ok: false }` when it does not look like one. `canonical` is the same mailbox written one way: lower case, without
 * `+tag`, and for Gmail without dots, so `a.b+x@gmail.com` and `ab@googlemail.com` are the same.
 */
function parseEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL) return { ok: false };
  const match = EMAIL_RE.exec(email);
  if (!match || email.includes('..') || email.startsWith('.') || email.split('@')[0].endsWith('.')) return { ok: false };
  const domain = match[1];
  let local = email.split('@')[0];
  let canonicalDomain = domain;
  local = local.replace(/\+.*$/, '');
  if (GOOGLE_DOMAINS.has(domain)) { local = local.replace(/\./g, ''); canonicalDomain = 'gmail.com'; }
  if (!local) return { ok: false };
  return { ok: true, email, domain, canonical: `${local}@${canonicalDomain}` };
}

/**
 * The reason a server does not take this email, or null: `invalid`, `disposable`, `blocked` (the server refused the domain) or `notAllowed` (the
 * server has a list of allowed domains and this is not on it). `rules` is `checks.email`.
 */
function emailRefusal(value, rules) {
  const parsed = parseEmail(value);
  if (!parsed.ok) return 'invalid';
  if (rules.blocked_domains?.length && inList(parsed.domain, rules.blocked_domains)) return 'blocked';
  if (rules.allowed_domains?.length) return inList(parsed.domain, rules.allowed_domains) ? null : 'notAllowed';
  if (rules.block_disposable !== false && inList(parsed.domain, list())) return 'disposable';
  return null;
}

module.exports = { parseEmail, emailRefusal, inList, list };
