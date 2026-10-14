// The anti scam detection: wording, fingerprints and the same message in several channels.
const assert = require('node:assert/strict');
const c = require('../src/utils/antiScamChecks');

const verdict = (text, attach = false) => c.wordingVerdict(text, { hasAttachment: attach }).scam;

// the real thing
assert.ok(verdict("MrBeast is giving away $2,500. Claim your reward now!"), 'the MrBeast scam');
assert.ok(verdict('You have been selected! Withdraw your 2,700 USDT balance here https://mrbeast-reward.xyz'), 'a fake withdrawal');
assert.ok(verdict('Join this casino and get free credits with promo code BEAST', true), 'a casino promo with a picture');
assert.ok(verdict('claim your free USDT reward, limited time', true));
// not scams
assert.ok(!verdict('hola, como estan todos'));
assert.ok(!verdict('alguien tiene un giveaway de nitro mañana?'), 'one kind alone is not enough');
assert.ok(!verdict('el casino de mi pueblo esta cerrado'));
assert.ok(!verdict('I won the match yesterday', true), 'a picture and a word are not a scam');
assert.ok(!verdict('mira mi wallet nueva de cuero'), 'a leather wallet');
assert.deepEqual(c.wordingKinds('MrBeast claim $100').sort(), ['celebrity', 'money', 'reward']);
assert.ok(c.hasLink('mira https://x.com/a') && c.hasLink('entra a mrbeast-gift.xyz') && !c.hasLink('hola'));

// fingerprints
const att = (name, size) => ({ name, size });
const msg = (content, attachments = []) => ({ content, attachments: new Map(attachments.map((a, i) => [i, a])) });
assert.deepEqual(c.fingerprints(msg('hola', [att('Win.PNG', 5000)])), ['a:win.png|5000'], 'a short text is not a fingerprint');
assert.equal(c.fingerprints(msg('Claim your reward NOW!!')).length, 1);
assert.equal(c.fingerprints(msg('claim your reward now')).at(0), c.fingerprints(msg('CLAIM your reward NOW!!')).at(0), 'case and symbols do not matter');
assert.notEqual(c.fingerprints(msg('', [att('a.png', 1)]))[0], c.fingerprints(msg('', [att('a.png', 2)]))[0], 'a different size is a different file');

// the same thing in several channels
const t0 = 1_000_000;
const send = (channelId, ts, fps = ['a:win.png|5000']) => {
  const entry = { ts, channelId, messageId: `m${ts}`, fps };
  const list = c.remember('g', 'u', entry);
  return c.repeatedAcrossChannels(list, entry, { threshold: 3, windowMs: 30_000 });
};
assert.equal(send('c1', t0), null);
assert.equal(send('c1', t0 + 1000), null, 'the same channel twice is only repeating');
assert.equal(send('c2', t0 + 2000), null);
const hit = send('c3', t0 + 3000);
assert.equal(hit.channels, 3);
assert.equal(hit.entries.length, 4, 'every copy is found, to take them all down');
assert.equal(c.recentEntries('g', 'u', 15, t0 + 4000).length, 4);
// slow spreading is not a burst
c.forget('g', 'u');
assert.equal(send('c1', t0), null);
assert.equal(send('c2', t0 + 20_000), null);
assert.equal(send('c3', t0 + 40_000), null, 'outside the window');
// two people sending the same thing are not one burst
const other = { ts: t0 + 41_000, channelId: 'c4', messageId: 'x', fps: ['a:win.png|5000'] };
const listOther = c.remember('g', 'someone-else', other);
assert.equal(c.repeatedAcrossChannels(listOther, other, { threshold: 3, windowMs: 30_000 }), null);
c.forget('g', 'u'); c.forget('g', 'someone-else');
assert.equal(c.recentEntries('g', 'u', 15, t0).length, 0);
c.sweep();
console.log('anti scam checks ok');
