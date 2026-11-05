// The allow-list of the link filter: domains whose links the "All links" filter lets through. Local only (no requests).
// The same rules are applied by the dashboard when it saves the list (petto-web, src/lib/linkDomains), keep them equal.
const { domainToASCII } = require('node:url');

const MAX_ALLOWED_DOMAINS = 50;
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * A domain as it is saved: lowercase, ASCII (punycode), with no scheme, user, port, path or `www.`.
 * Returns null when it is not a valid domain name (IP addresses and single words included).
 */
function normalizeDomain(input) {
  let value = String(input ?? '').trim().toLowerCase();
  if (!value || value.length > 300 || /[\s\\]/.test(value)) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\/\//, '');
  value = value.replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  if (value.includes('@')) return null;
  value = value.replace(/^\*\./, '').replace(/^\.+/, '').replace(/\.+$/, '').replace(/^www\./, '');
  if (!value || !/^[\p{L}\p{N}.-]+$/u.test(value)) return null;
  const ascii = domainToASCII(value);
  return ascii && DOMAIN_RE.test(ascii) ? ascii : null;
}

/** Normalizes a list: the valid ones (no repeats, at most MAX_ALLOWED_DOMAINS) and the entries that were rejected. */
function normalizeDomainList(inputs) {
  const domains = [];
  const invalid = [];
  for (const raw of inputs ?? []) {
    if (!String(raw ?? '').trim()) continue;
    const domain = normalizeDomain(raw);
    if (!domain) invalid.push(String(raw).trim().slice(0, 80));
    else if (!domains.includes(domain)) domains.push(domain);
  }
  return { domains: domains.slice(0, MAX_ALLOWED_DOMAINS), invalid, overflow: Math.max(0, domains.length - MAX_ALLOWED_DOMAINS) };
}

/** The host of a link as the browser would read it (lowercase, punycode, no port, user or final dot), or null. */
function hostOf(candidate) {
  if (/\\/.test(candidate)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  try {
    return new URL(withScheme).hostname.replace(/\.$/, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

/** True when the host is one of the domains or a subdomain of one (`a.example.com` yes, `evil-example.com` no). */
function hostIsAllowed(host, allowed) {
  if (!host) return false;
  return (allowed ?? []).some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// http(s) links and `www.` links, and domains written with no scheme.
const LINK_RE = /(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s<>]*)?/gi;

/**
 * The message with the links of allowed domains taken out. A link that is not allowed stays, so a message is only exempt
 * from the filter when what is left no longer matches it: that is, when every link in it is on the list.
 */
function stripAllowedLinks(content, allowed) {
  if (!allowed?.length) return content;
  return String(content ?? '').replace(LINK_RE, (match) => {
    // Punctuation that ends a sentence or a Markdown link is not part of the address.
    const clean = match.replace(/[\],.!?;:)}'"*_~|]+$/, '');
    return hostIsAllowed(hostOf(clean), allowed) ? ' ' : match;
  });
}

module.exports = { MAX_ALLOWED_DOMAINS, normalizeDomain, normalizeDomainList, hostOf, hostIsAllowed, stripAllowedLinks };
