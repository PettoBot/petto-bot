// Checks the letters captcha: the picture, the signed ticket, the right and wrong answers, the five tries per link, and the time limit.
const assert = require('node:assert/strict');
const path = require('node:path');

const configPath = require.resolve(path.join(__dirname, '..', 'src/config.js'));
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { verifyTokenSecret: 'test-secret-for-the-captcha' } };
const captcha = require('../src/utils/verifyCaptcha');

const now = Date.UTC(2026, 9, 13, 12);
const challenge = (jti, text = 'AB7K2') => captcha.createChallenge(jti, { text, now });

assert.deepEqual([...challenge('j1').png.subarray(1, 4)], [80, 78, 71], 'the picture is a PNG');
assert.ok(challenge('j1').png.length > 1500, 'and it has something in it');
for (let i = 0; i < 200; i += 1) assert.match(captcha.randomText(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{5}$/, 'letters that look alike are left out');

const good = challenge('j1');
assert.deepEqual(captcha.checkAnswer('j1', good.ticket, 'AB7K2', { now }), { ok: true });
assert.deepEqual(captcha.checkAnswer('j1', good.ticket, 'ab7k2', { now }), { ok: true }, 'small letters work');
assert.deepEqual(captcha.checkAnswer('j1', good.ticket, ' AB7 K2 ', { now }), { ok: true }, 'spaces are ignored');
assert.equal(captcha.checkAnswer('j1', good.ticket, 'ZZZZZ', { now }).reason, 'wrong');
assert.equal(captcha.checkAnswer('j2', good.ticket, 'AB7K2', { now }).reason, 'invalid', 'a ticket belongs to its link');
assert.equal(captcha.checkAnswer('j1', `${good.ticket}x`, 'AB7K2', { now }).reason, 'invalid', 'a changed ticket is refused');
assert.equal(captcha.checkAnswer('j1', 'nonsense', 'AB7K2', { now }).reason, 'invalid');
assert.equal(captcha.checkAnswer('j1', good.ticket, 'AB7K2', { now: now + (captcha.TICKET_TTL_SECONDS + 5) * 1000 }).reason, 'expired', 'a ticket lasts a few minutes');

// Five wrong answers lock the link, even for the right one, until the wait is over.
captcha.clearAttempts();
const t = challenge('j3').ticket;
const results = Array.from({ length: captcha.MAX_WRONG }, () => captcha.checkAnswer('j3', t, 'NOPE1', { now }).reason);
assert.deepEqual(results, ['wrong', 'wrong', 'wrong', 'wrong', 'locked']);
assert.equal(captcha.checkAnswer('j3', t, 'AB7K2', { now }).reason, 'locked');
assert.equal(captcha.checkAnswer('j3', t, 'AB7K2', { now: now + 11 * 60_000 }).ok, false, 'after the wait the old ticket has expired');
assert.equal(captcha.checkAnswer('j3', captcha.createChallenge('j3', { text: 'QQ223', now: now + 11 * 60_000 }).ticket, 'QQ223', { now: now + 11 * 60_000 }).ok, true, 'but a new one works');
// The method of a server and what the page shows for each one.
const { methodOf, usesTurnstile, usesLetters } = require('../src/utils/verifyMethod');
assert.deepEqual([undefined, null, {}, { method: 'letters' }, { method: 'both' }, { method: 'nonsense' }].map(methodOf), ['turnstile', 'turnstile', 'turnstile', 'letters', 'both', 'turnstile']);
assert.deepEqual(['turnstile', 'letters', 'both'].map((m) => [usesTurnstile(m), usesLetters(m)]), [[true, false], [false, true], [true, true]]);
const { renderVerifyPage, pickLanguage } = require('../src/web/verifyPage');
const page = (method, extra = {}) => renderVerifyPage({ token: 'a.b', siteKey: 'site', method, ...extra });
assert.ok(page('turnstile').includes('class="cf-turnstile"') && !page('turnstile').includes('id="letters-img"'), 'turnstile: only the Cloudflare check');
assert.ok(!page('letters').includes('class="cf-turnstile"') && !page('letters').includes('challenges.cloudflare.com') && page('letters').includes('id="letters-img"'), 'letters: no Cloudflare at all');
assert.ok(page('both').includes('class="cf-turnstile"') && page('both').includes('id="letters-img"'), 'both: the two');
assert.ok(page('letters', { guildName: 'A <b>Server</b>' }).includes('A &lt;b&gt;Server&lt;/b&gt;'), 'the name of the server is shown and escaped');
assert.ok(page('letters', { lang: 'es' }).includes('Escribe las letras que ves') && page('letters', { lang: 'pt' }).includes('Digite as letras'), 'in Spanish and Portuguese');
assert.deepEqual(['es-CO,es;q=0.9,en;q=0.8', 'pt-BR,pt;q=0.9', 'fr-FR,fr', undefined].map(pickLanguage), ['es', 'pt', 'en', 'en']);
console.log('Checked the letters captcha: picture, ticket, answers, tries and time limit.');
