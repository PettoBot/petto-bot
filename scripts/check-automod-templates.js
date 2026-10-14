// The AutoMod templates: every pattern fits Discord's limits, compiles in JavaScript and catches what it should.
const assert = require('node:assert/strict');
const { TEMPLATE_IDS, PACKS, buildPatterns, toDiscordPattern, toRegExp, resolveOptions } = require('../src/utils/automodTemplates');

const hits = (id, text, options) => buildPatterns(id, options).some((p) => toRegExp(p)?.test(text));

for (const id of TEMPLATE_IDS) {
  const patterns = buildPatterns(id, {});
  assert.ok(patterns.length >= 1 && patterns.length <= 10, `${id}: 1 to 10 patterns`);
  for (const p of patterns) {
    assert.ok(toDiscordPattern(p).length <= 260, `${id}: a pattern is over 260 characters (${toDiscordPattern(p).length})`);
    assert.ok(toRegExp(p), `${id}: does not compile`);
    assert.ok(!/\(\?[=!<]/.test(p.source) && !/\\[1-9]/.test(p.source), `${id}: Discord has no lookaround or backreferences`);
    assert.match(p.flags, /^[ims]*$/, `${id}: only i, m and s flags`);
  }
}
for (const id of TEMPLATE_IDS) {
  // the strictest options still fit
  const worst = { nonClickable: true, thirdParty: true, max: 12, times: 30, words: 20, level: 3 };
  for (const p of buildPatterns(id, worst)) assert.ok(toDiscordPattern(p).length <= 260, `${id} (strict): too long`);
}

// links
assert.ok(hits('links', 'mira https://example.com/x'));
assert.ok(hits('links', 'h t t p s : / / example . com'), 'a link with spaces');
assert.ok(!hits('links', 'hola, como estas'));
assert.ok(!hits('links', 'visita example.com'), 'a link without https is only caught when asked');
assert.ok(hits('links', 'visita example.com', { nonClickable: true }));
// invites
assert.ok(hits('invites', 'entra discord.gg/abc123'));
assert.ok(hits('invites', 'https://discord.com/invite/abc'));
assert.ok(!hits('invites', 'discord es genial'));
assert.ok(!hits('invites', 'mira dsc.gg/algo'));
assert.ok(hits('invites', 'mira dsc.gg/algo', { thirdParty: true }));
// inline links
assert.ok(hits('inline_links', '[click aqui](https://evil.com)'));
assert.ok(!hits('inline_links', 'solo texto [corchetes]'));
assert.ok(!hits('inline_links', '[click aqui](https://evil.com)', { disguisedOnly: true }));
assert.ok(hits('inline_links', '[google.com](https://evil.com)', { disguisedOnly: true }));
// emails
assert.ok(hits('emails', 'escribeme a liam@example.com'));
assert.ok(hits('emails', 'liam [at] example [dot] com'));
assert.ok(!hits('emails', 'hola @liam'));
// emojis
assert.ok(hits('emojis', '😀😀😀😀😀😀😀', { max: 6 }));
assert.ok(!hits('emojis', '😀😀😀😀😀😀', { max: 6 }));
assert.ok(hits('emojis', 'hola 😀 que <:pe:123456789012345678> tal 🎉', { max: 2 }));
assert.ok(!hits('emojis', 'hola 😀 que tal', { max: 1 }));
assert.ok(hits('emojis', '😀', { max: 0 }));
// zalgo, headings, subtext
assert.ok(hits('zalgo', 'h̀́̂̃ola'));
assert.ok(!hits('zalgo', 'héllo'), 'one accent is fine');
assert.ok(hits('zalgo', 'héllo', { filterAccents: true }));
assert.ok(hits('headings', '# titulo'));
assert.ok(hits('headings', 'hola\n### titulo'));
assert.ok(!hits('headings', 'esto # no es titulo'));
assert.ok(!hits('headings', '### h3', { level: 2 }));
assert.ok(hits('headings', '## h2', { level: 2 }));
assert.ok(hits('subtext', '-# texto pequeno'));
assert.ok(!hits('subtext', 'guion - normal'));
// the rest
assert.ok(hits('scam', 'FREE NITRO click here'));
assert.ok(hits('scam', 'steam gift for you'));
assert.ok(!hits('scam', 'me gusta steam'));
assert.ok(hits('ip_addresses', 'mi ip es 192.168.1.20'));
assert.ok(!hits('ip_addresses', 'version 1.2.3'));
assert.ok(hits('caps', 'ESTO ES UN GRITO MUY LARGO DE VERDAD'));
assert.ok(!hits('caps', 'Hola Liam como estas hoy'));
assert.ok(hits('repeated_characters', 'holaaaaaaaaaaaa'));
assert.ok(hits('repeated_characters', 'noooo!!!!!!!!!!!'));
assert.ok(!hits('repeated_characters', 'jajaja que bien'));
assert.ok(hits('spoilers', '||a|| ||b|| ||c|| ||d||'));
assert.ok(!hits('spoilers', '||a|| ||b||'));
assert.ok(hits('invisible_text', 'a​​​b'));
assert.ok(hits('fake_pings', 'hola @everyone'));
assert.ok(hits('fake_pings', '@ here'));
assert.ok(!hits('fake_pings', 'mi mail es a@everyday.com'));

// options are clamped and unknown keys dropped
assert.deepEqual(resolveOptions('emojis', { max: 99, nope: 1 }), { max: 12 });
assert.deepEqual(resolveOptions('links', {}), { nonClickable: false });
assert.deepEqual(buildPatterns('nope', {}), []);
assert.equal(toDiscordPattern({ source: 'x', flags: 'im' }), '(?im)x');
assert.equal(toDiscordPattern({ source: 'x', flags: '' }), 'x');

// packs only name templates that exist and fit one rule (10 patterns)
for (const [name, pack] of Object.entries(PACKS)) {
  const all = pack.templates.flatMap(([id, options]) => { assert.ok(TEMPLATE_IDS.includes(id), `${name}: ${id} exists`); return buildPatterns(id, options); });
  assert.ok(all.length <= 10, `${name}: ${all.length} patterns do not fit one rule`);
}
console.log('automod templates ok');
