// The allowed domains of the "All links" filter: normalizing, matching and the message event.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const d = require('../src/utils/linkDomains');

// normalizing what is typed
const n = d.normalizeDomain;
assert.equal(n('Example.COM'), 'example.com');
assert.equal(n('https://www.Example.com/path?q=1#x'), 'example.com', 'scheme, www and path are dropped');
assert.equal(n('example.com:8080'), 'example.com', 'port is dropped');
assert.equal(n('example.com.'), 'example.com', 'final dot is dropped');
assert.equal(n('*.example.com'), 'example.com', 'a wildcard is the domain itself');
assert.equal(n('sub.example.co.uk'), 'sub.example.co.uk');
assert.equal(n('münchen.de'), 'xn--mnchen-3ya.de', 'IDN becomes punycode');
assert.equal(n('xn--mnchen-3ya.de'), 'xn--mnchen-3ya.de');
for (const bad of ['', '   ', 'localhost', '1.2.3.4', '[::1]', 'a..b.com', '-x.com', 'x-.com', 'foo.c', 'bad domain.com', 'user@example.com', 'http://user@example.com', 'exa_mple.com', 'example.com\\evil.com', 'x'.repeat(64) + '.com', null, undefined]) {
  assert.equal(n(bad), null, `${JSON.stringify(bad)} is not a domain`);
}
const list = d.normalizeDomainList(['example.com', 'HTTPS://Example.com/x', 'nope', '', 'foo.org']);
assert.deepEqual(list, { domains: ['example.com', 'foo.org'], invalid: ['nope'], overflow: 0 }, 'repeats are merged, junk is reported, blanks skipped');
const many = d.normalizeDomainList(Array.from({ length: 60 }, (_, i) => `site${i}.com`));
assert.equal(many.domains.length, d.MAX_ALLOWED_DOMAINS);
assert.equal(many.overflow, 10);

// matching: a message passes only when every link in it is allowed
const allowed = ['example.com', 'xn--mnchen-3ya.de'];
const rest = (text) => d.stripAllowedLinks(text, allowed);
const passes = (text) => rest(text).trim() === '' || !/https?:|www\.|\.\w{2,}/i.test(rest(text));
for (const ok of [
  'http://example.com', 'https://example.com/a/b?c=d#e', 'HTTPS://EXAMPLE.COM/PATH', 'https://www.example.com', 'https://sub.deep.example.com/x',
  'https://example.com:8443/x', 'http://user:pass@example.com/', 'https://example.com./x', 'look at https://example.com, nice',
  '[docs](https://example.com/docs)', '<https://example.com>', 'https://münchen.de/x', 'https://MÜNCHEN.de', 'https://xn--mnchen-3ya.de', 'www.example.com/x',
  'https://example.com and https://sub.example.com/y',
]) assert.equal(passes(ok), true, `${ok} is allowed`);
for (const bad of [
  'https://evil-example.com', 'https://notexample.com', 'https://example.com.evil.com', 'https://example.com@evil.com', 'https://evil.com/?u=example.com',
  'https://evil.com/example.com', 'https://example.org', 'https://example.com and https://evil.com', 'https://example.com\\@evil.com', 'https://evil.com#@example.com',
  'https://example.com.evil.com/', 'https://exampleXcom.com', 'https://xn--mnchen-3ya.de.evil.com', 'http://1.2.3.4/example.com',
]) assert.equal(passes(bad), false, `${bad} is not allowed`);
assert.equal(d.stripAllowedLinks('https://example.com', []), 'https://example.com', 'an empty list changes nothing');
assert.equal(d.hostOf('http://user@Example.COM.:80/x'), 'example.com');
assert.equal(d.hostIsAllowed('a.example.com', ['example.com']), true);
assert.equal(d.hostIsAllowed('badexample.com', ['example.com']), false);
assert.equal(d.hostIsAllowed(null, ['example.com']), false);

// the event: the "All links" filter with an allow-list
const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
let config = {};
const applied = [];
const { buildPatterns, toRegExp } = require('../src/utils/automodTemplates');
const rule = (template, options = {}) => ({ id: 1, name: template, template, options, action: 'warn', mute_minutes: 10, enabled: true, exempt_role_ids: [], exempt_channel_ids: [], hits: 0, regexes: buildPatterns(template, options).map(toRegExp) });
let rules = [];
stub('../src/db/automod', { getConfig: async () => config, listSilentChannelsCached: async () => [] });
stub('../src/db/automodRules', { listCompiled: async () => rules, countHit: () => {} });
stub('../src/utils/automodAction', { applyAutomodAction: async (m, o) => applied.push(o) });
stub('../src/utils/honeypot', { handleHoneypotMessage: async () => false });
stub('../src/db/maliciousLinks', { findKnownMalicious: async () => [] });
stub('../src/utils/senderIdentity', { sendAs: async () => null });
const event = require('../src/events/messageCreateAutomod');
const msg = (content) => ({ guild: { id: 'g1' }, author: { id: 'u1', bot: false }, content, channel: { id: 'c1', parentId: null }, mentions: { users: { size: 0 }, roles: { size: 0 }, everyone: false }, member: { permissions: { has: () => false }, roles: { cache: { has: () => false } } } });
const hit = async (content) => { applied.length = 0; await event.execute(msg(content)); return applied.length > 0; };

(async () => {
  rules = [rule('links')];
  config = { allowed_link_domains: [] };
  assert.equal(await hit('https://example.com/x'), true, 'with no list every link is caught');
  config = { allowed_link_domains: ['example.com'] };
  assert.equal(await hit('https://example.com/x and https://www.example.com'), false, 'only allowed links pass');
  assert.equal(await hit('https://example.com/x and https://evil.com'), true, 'one link that is not allowed is enough');
  assert.equal(await hit('https://evil-example.com'), true, 'a lookalike is not the domain');
  assert.equal(await hit('h t t p s : / / evil.com'), true, 'a disguised link is still caught');
  assert.equal(await hit('https://example.com/x h t t p s : / / evil.com'), true, 'an allowed link does not hide a disguised one');
  config = {};
  assert.equal(await hit('https://example.com'), true, 'a server with no config');
  // bare domains only count when the filter looks for them
  config = { allowed_link_domains: ['example.com'] };
  rules = [rule('links', { nonClickable: true })];
  assert.equal(await hit('see example.com/page'), false);
  assert.equal(await hit('see example.com/page and evil.com'), true);
  // other filters are not touched by the list
  rules = [rule('inline_links')];
  assert.equal(await hit('[a](https://example.com)'), true, 'the list is only for the all links filter');
  console.log('link domains ok');
})().catch((err) => { console.error(err); process.exit(1); });
