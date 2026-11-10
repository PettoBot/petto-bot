// The extra checks of the verification: Tor, alt accounts, the Discord account and the email code (utils/verifyChecks.js, torList, disposableEmail, emailCode, resend),
// the settings and the command, the verification page, and the whole way through the real HTTP routes of the bot with Discord, the database and Resend replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { UserFlagsBitField, UserFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const warned = [];
stub('src/utils/logger.js', { info() {}, warn: (...a) => warned.push(a.join(' ')), error() {}, debug() {} });

// What the routes read and write.
let settings = { method: 'letters', unverified_role_id: 'un', verified_role_id: 'ok', checks: {} };
const claimed = new Set();
stub('src/db/verificationConfig.js', { getConfig: async () => settings, upsertConfig: async () => settings });
stub('src/db/verificationRedemptions.js', { isRedeemed: async (jti) => claimed.has(jti), claimRedemption: async ({ jti }) => { if (claimed.has(jti)) return false; claimed.add(jti); return true; }, releaseRedemption: async (jti) => { claimed.delete(jti); }, hasEverVerified: async () => false });
const applied = [];
stub('src/utils/verifyApply.js', { applyVerificationRoles: async ({ member }) => { applied.push(member.id); return { noRole: false }; }, applyVerification: async () => ({ ok: true }) });
stub('src/utils/verifyMessage.js', { sendVerifiedDM: async () => {}, sendVerifyDM: async () => {} });
const logs = [];
stub('src/utils/verificationLog.js', { logVerification: async () => { logs.push({ kind: 'passed' }); }, logVerificationChecks: async (c, g, u, info) => { logs.push({ kind: info.blocked ? 'blocked' : 'warned', codes: info.reasons.map((r) => r.code) }); }, reasonLine: () => '' });
stub('src/utils/verifyCaptcha.js', { createChallenge: () => ({ png: Buffer.from('x'), ticket: 'tk' }), checkAnswer: () => ({ ok: true }), TICKET_TTL_SECONDS: 300 });
const signalRows = new Map(); // `${guild}:${user}` -> { ipHash, emailHash }
const signalStore = {
  record: async ({ guildId, userId, ipHash, emailHash }) => { signalRows.set(`${guildId}:${userId}`, { ipHash, emailHash }); },
  findMatches: async (guildId, userId, { ipHash, emailHash }) => [...signalRows.entries()].filter(([key, row]) => key.startsWith(`${guildId}:`) && key !== `${guildId}:${userId}` && ((ipHash && row.ipHash === ipHash) || (emailHash && row.emailHash === emailHash))).map(([key, row]) => ({ user_id: key.split(':')[1], by: emailHash && row.emailHash === emailHash ? 'email' : 'ip' })),
  purgeOlderThan: async () => 0,
};
stub('src/db/verificationSignals.js', signalStore);
const sent = [];
let resendOn = true;
const resendReal = require('../src/utils/resend'); // the real one, to check the email itself; the routes get a copy that sends nothing
stub('src/utils/resend.js', { configured: () => resendOn, sendCodeEmail: async (mail) => { sent.push(mail); return { ok: true }; }, buildCodeEmail: resendReal.buildCodeEmail });
require('../src/db/guilds').ensureGuild = async () => ({});

const config = require('../src/config');
Object.assign(config, { verifyBaseUrl: 'https://verify.example', verifyTokenSecret: 'check-verify-checks-secret', dashboardApiSecret: 'dash-key', topggWebhookSecret: '', webPort: 0, turnstileSiteKey: 'site', cloudflareTunnelToken: null });
const checksLib = require('../src/utils/verifyChecks');
const torList = require('../src/utils/torList');
const disposable = require('../src/utils/disposableEmail');
const emailCode = require('../src/utils/emailCode');
const { createToken } = require('../src/utils/verifyToken');
const { startServer } = require('../src/web/server');
const { renderVerifyPage } = require('../src/web/verifyPage');

const { normalizeChecks, domainList, applyChange, normalizeIp, clientIp, signalHash, accountReasons, evaluate } = checksLib;

(async () => {
  // --- the settings: anything wrong is "off", so an old row or a bad value never blocks anybody
  assert.deepEqual(normalizeChecks(undefined), normalizeChecks({}));
  assert.deepEqual(normalizeChecks({ tor: 'nonsense', alt: 5, account: 'x', email: [] }), { tor: 'off', alt: 'off', account: { mode: 'off', min_age_days: 0, no_avatar: false, flagged: true }, email: { required: false, common_only: true, block_disposable: true, allowed_domains: [], blocked_domains: [] } });
  const full = normalizeChecks({ tor: 'block', alt: 'warn', account: { mode: 'block', min_age_days: '400', no_avatar: true, flagged: false }, email: { required: true, block_disposable: false, allowed_domains: 'A.com, b.org\nhttps://c.net/path @d.io nonsense', blocked_domains: ['x.com', 'x.com'] } });
  assert.deepEqual([full.tor, full.alt, full.account.min_age_days, full.account.no_avatar, full.account.flagged], ['block', 'warn', 365, true, false], 'the age is capped');
  assert.deepEqual(full.email.allowed_domains, ['a.com', 'b.org', 'c.net', 'd.io']);
  assert.deepEqual([full.email.required, full.email.common_only, full.email.block_disposable, full.email.blocked_domains], [true, true, false, ['x.com']]);
  assert.equal(normalizeChecks({ email: { common_only: false } }).email.common_only, false);
  assert.equal(domainList(Array.from({ length: 80 }, (_, i) => `d${i}.com`)).length, 50, 'at most 50 domains');
  assert.equal(checksLib.anyCheck(normalizeChecks({})), false);
  assert.equal(checksLib.anyCheck(normalizeChecks({ account: { mode: 'warn' } })), true);
  assert.equal(checksLib.needsWebPage(normalizeChecks({ account: { mode: 'block' } })), false, 'the account check works inside Discord too');
  assert.equal(checksLib.needsWebPage(normalizeChecks({ tor: 'warn' })), true);
  assert.equal(checksLib.needsWebPage(normalizeChecks({ email: { required: true } })), true);

  // --- changes from the command
  let c = applyChange({}, { check: 'tor', mode: 'block' }).checks;
  assert.equal(c.tor, 'block');
  assert.equal(applyChange(c, { check: 'tor', mode: 'on' }).ok, false, '`on` is for the email only');
  assert.equal(applyChange(c, { check: 'nonsense', mode: 'off' }).ok, false);
  c = applyChange(c, { check: 'account', mode: 'warn', minAge: 7, avatar: true }).checks;
  assert.deepEqual([c.account.mode, c.account.min_age_days, c.account.no_avatar, c.account.flagged], ['warn', 7, true, true]);
  c = applyChange(c, { check: 'account', minAge: 0 }).checks;
  assert.equal(c.account.min_age_days, 0);
  c = applyChange(c, { check: 'email', mode: 'on', allow: 'a.com, b.org', deny: 'x.com' }).checks;
  assert.deepEqual([c.email.required, c.email.allowed_domains, c.email.blocked_domains], [true, ['a.com', 'b.org'], ['x.com']]);
  assert.equal(applyChange(c, { check: 'email', common: false }).checks.email.common_only, false);
  c = applyChange(c, { check: 'email', allow: 'none' }).checks;
  assert.deepEqual(c.email.allowed_domains, []);
  assert.equal(applyChange(c, { check: 'email', mode: 'block' }).ok, false);
  assert.equal(c.tor, 'block', 'the rest is kept');

  // --- addresses and hashes
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('2001:DB8::1'), '2001:db8::1');
  for (const bad of ['', 'nope', '999.1.1.1', null]) assert.equal(normalizeIp(bad), null, `${bad} is no address`);
  const req = (header, ip) => ({ ip, get: (name) => (name === 'cf-connecting-ip' ? header : undefined) });
  assert.equal(clientIp(req('9.9.9.9', '10.0.0.1')), '10.0.0.1', 'without the tunnel the header is not trusted');
  config.cloudflareTunnelToken = 'tunnel';
  assert.equal(clientIp(req('9.9.9.9', '10.0.0.1')), '9.9.9.9', 'behind the tunnel the header of Cloudflare is the visitor');
  assert.equal(clientIp(req(undefined, '10.0.0.1')), '10.0.0.1');
  config.cloudflareTunnelToken = null;
  assert.equal(signalHash('g1', 'ip', '1.2.3.4'), signalHash('g1', 'ip', '1.2.3.4'));
  assert.notEqual(signalHash('g1', 'ip', '1.2.3.4'), signalHash('g2', 'ip', '1.2.3.4'), 'a hash is for one server');
  assert.notEqual(signalHash('g1', 'ip', '1.2.3.4'), signalHash('g1', 'email', '1.2.3.4'));
  assert.ok(!signalHash('g1', 'ip', '1.2.3.4').includes('1.2.3.4'));
  const secret = config.verifyTokenSecret; config.verifyTokenSecret = null;
  assert.equal(signalHash('g1', 'ip', '1.2.3.4'), null, 'no secret, no signal'); config.verifyTokenSecret = secret;

  // --- Tor
  assert.deepEqual([...torList.parseList('# list\n1.2.3.4\n2001:DB8::1 # exit\nnonsense\n\n::ffff:5.6.7.8')].sort(), ['1.2.3.4', '2001:db8::1', '5.6.7.8']);
  assert.equal(torList.isExit('1.2.3.4'), false, 'nothing is on a list that was never read');
  const lines = (n) => Array.from({ length: n }, (_, i) => `198.51.${Math.floor(i / 250)}.${i % 250 + 1}`).join('\n');
  assert.equal(await torList.refresh({ fetcher: async () => ({ ok: true, text: async () => lines(300) }) }), 300);
  assert.equal(torList.isExit('198.51.0.1'), true);
  assert.equal(await torList.refresh({ fetcher: async () => ({ ok: true, text: async () => lines(5) }) }), 0, 'a list that is too short is a mistake');
  assert.equal(torList.isExit('198.51.0.1'), true, 'the one read before is kept');
  assert.equal(await torList.refresh({ fetcher: async () => { throw new Error('offline'); } }), 0);
  assert.equal(await torList.refresh({ fetcher: async () => ({ ok: false, status: 503 }) }), 0);
  torList.setForTest(['203.0.113.7']);

  // --- emails
  assert.deepEqual(disposable.parseEmail('  Jane.Doe+news@Gmail.com '), { ok: true, email: 'jane.doe+news@gmail.com', domain: 'gmail.com', canonical: 'janedoe@gmail.com', alias: true });
  assert.equal(disposable.parseEmail('janedoe@googlemail.com').canonical, 'janedoe@gmail.com', 'the same Gmail mailbox written two ways');
  assert.equal(disposable.parseEmail('a.b+x@outlook.com').canonical, 'a.b@outlook.com', 'dots are only ignored by Gmail');
  for (const bad of ['', 'x', 'a@b', 'a@@b.com', '@b.com', 'a b@c.com', 'a..b@c.com', '+x@c.com', `${'a'.repeat(250)}@b.com`]) assert.equal(disposable.parseEmail(bad).ok, false, `${bad.slice(0, 20)} is no email`);
  const rules = (extra = {}) => ({ block_disposable: true, allowed_domains: [], blocked_domains: [], ...extra });
  assert.equal(disposable.list().size > 5000, true, 'the list of throwaway domains is there');
  assert.equal(disposable.emailRefusal('x@mailinator.com', rules({ common_only: false })), 'disposable');
  assert.equal(disposable.emailRefusal('x@sub.mailinator.com', rules({ common_only: false })), 'disposable', 'a subdomain of one');
  assert.equal(disposable.emailRefusal('x@mailinator.com', rules({ common_only: false, block_disposable: false })), null);
  assert.equal(disposable.emailRefusal('x@mailinator.com', rules()), 'custom', 'by default only the providers everybody knows: a throwaway domain is not one');
  for (const ok of ['x@gmail.com', 'x@googlemail.com', 'x@outlook.com', 'x@hotmail.com', 'x@hotmail.es', 'x@outlook.com.br', 'x@live.com.mx', 'x@yahoo.co.uk', 'x@icloud.com', 'x@proton.me', 'x@protonmail.com', 'x@pm.me', 'x@aol.com', 'x@gmx.com', 'x.y@gmail.com']) assert.equal(disposable.emailRefusal(ok, rules()), null, `${ok} is accepted`);
  for (const custom of ['liam@petto.sbs', 'x@example.com', 'x@mail.gmail.com', 'x@gmail.com.evil.org', 'x@mycompany.io', 'x@hotmail.evil.com', 'x@outlook.fake']) assert.equal(disposable.emailRefusal(custom, rules()), 'custom', `${custom} is a domain of somebody, not a provider`);
  assert.equal(disposable.emailRefusal('liam@petto.sbs', rules({ common_only: false })), null, 'with "only well-known providers" off any domain that is not throwaway is accepted');
  assert.equal(disposable.emailRefusal('jane+news@gmail.com', rules()), 'alias', 'a + is refused, not cleaned');
  assert.equal(disposable.emailRefusal('jane+news@gmail.com', rules({ common_only: false })), 'alias');
  assert.equal(disposable.emailRefusal('jane+news@school.edu', rules({ allowed_domains: ['school.edu'] })), 'alias', 'also for a domain the server allowed');
  assert.equal(disposable.emailRefusal('nonsense', rules()), 'invalid');
  assert.equal(disposable.emailRefusal('x@gmail.com', rules({ blocked_domains: ['gmail.com'] })), 'blocked');
  assert.equal(disposable.emailRefusal('x@mail.evil.org', rules({ common_only: false, blocked_domains: ['evil.org'] })), 'blocked');
  assert.equal(disposable.emailRefusal('x@school.edu', rules({ allowed_domains: ['school.edu'] })), null, 'the domains of the server replace the providers everybody knows');
  assert.equal(disposable.emailRefusal('x@gmail.com', rules({ allowed_domains: ['school.edu'] })), 'notAllowed');

  // --- the code
  emailCode.reset();
  const t0 = 1_000_000;
  const first = emailCode.issue('j1', 'a@b.com', t0);
  assert.match(first.code, /^\d{6}$/);
  assert.deepEqual(emailCode.issue('j1', 'a@b.com', t0 + 1000), { ok: false, reason: 'cooldown', waitMs: emailCode.COOLDOWN_MS - 1000 });
  assert.equal(emailCode.confirm('nobody', '123456', t0).reason, 'none');
  assert.equal(emailCode.confirm('j1', first.code === '000000' ? '111111' : '000000', t0 + 2000).reason, 'wrong');
  assert.deepEqual(emailCode.confirm('j1', ` ${first.code.slice(0, 3)} ${first.code.slice(3)} `, t0 + 3000), { ok: true, email: 'a@b.com' }, 'spaces do not matter');
  assert.equal(emailCode.confirmedEmail('j1', t0 + 4000), 'a@b.com');
  assert.equal(emailCode.confirmedEmail('j1', t0 + 31 * 60_000), null, 'the confirmation does not last forever');
  assert.equal(emailCode.confirm('j1', first.code, t0 + 5000).reason, 'none', 'a code works once');
  const second = emailCode.issue('j2', 'b@b.com', t0);
  assert.equal(emailCode.confirm('j2', second.code, t0 + emailCode.CODE_TTL_MS + 1).reason, 'expired');
  const third = emailCode.issue('j3', 'c@b.com', t0); const wrong = third.code === '123456' ? '654321' : '123456';
  for (let i = 0; i < emailCode.MAX_TRIES - 1; i += 1) assert.equal(emailCode.confirm('j3', wrong, t0 + i).reason, 'wrong');
  assert.equal(emailCode.confirm('j3', wrong, t0 + 10).reason, 'locked', 'five wrong tries lock the code');
  assert.equal(emailCode.confirm('j3', third.code, t0 + 11).reason, 'locked', 'even the right one');
  let at = t0; const sendsOk = [];
  for (let i = 0; i < emailCode.MAX_SENDS + 1; i += 1) { sendsOk.push(emailCode.issue('j4', `d${i}@b.com`, at)); at += emailCode.COOLDOWN_MS + 1; }
  assert.deepEqual(sendsOk.map((r) => r.ok), [true, true, true, false]);
  assert.equal(sendsOk[3].reason, 'limit', 'three codes in ten minutes for each link');
  assert.equal(emailCode.issue('j4', 'e@b.com', at + 10 * 60_000).ok, true, 'and again later');
  emailCode.reset();
  let when = t0; const sameAddress = [];
  for (let i = 0; i < emailCode.MAX_PER_ADDRESS + 1; i += 1) { sameAddress.push(emailCode.issue(`other-${i}`, 'victim@example.com', when)); when += 1000; }
  assert.deepEqual(sameAddress.map((r) => r.ok), [true, true, true, false], 'one address gets three codes an hour, even from different links');
  assert.equal(emailCode.issue('other-9', 'someone@example.com', when).ok, true, 'another address is not affected');
  emailCode.reset();

  // --- the email itself
  for (const lang of ['en', 'es', 'pt-BR']) {
    const mail = resendReal.buildCodeEmail({ code: '482913', lang, guildName: 'Casa <b>&"', minutes: 10 });
    assert.ok(mail.subject.includes('482913') && mail.text.includes('482913'), `${lang}: the code is in the subject and the text`);
    for (const digit of '482913') assert.ok(mail.html.includes(`>${digit}</td>`), `${lang}: a box for each digit`);
    assert.ok(mail.html.includes('Casa &lt;b&gt;&amp;&quot;') && !mail.html.includes('Casa <b>'), `${lang}: the name of the server is escaped`);
    assert.ok(mail.html.includes(`<html lang="${lang}"`) && mail.html.includes('mascot-icon.png') && mail.html.includes('/assets/mail-banner.jpg'));
    assert.ok(mail.html.includes('/terms') && mail.html.includes('/privacy') && mail.html.includes('discord.gg/petto'), `${lang}: the footer has the links`);
    assert.ok(!/aliases?|resend/i.test(mail.html.replace(/https?:[^"']*/g, '')), `${lang}: nothing technical in the email`);
    assert.ok(!/\{[a-z]+\}/.test(mail.html + mail.text + mail.subject), `${lang}: no placeholder left`);
  }
  assert.notEqual(resendReal.buildCodeEmail({ code: '111111', lang: 'es', guildName: 'x' }).subject, resendReal.buildCodeEmail({ code: '111111', lang: 'en', guildName: 'x' }).subject);
  const calls = [];
  const fetcher = (result) => async (url, options) => { calls.push({ url, options }); if (result instanceof Error) throw result; return result; };
  assert.deepEqual(await resendReal.sendCodeEmail({ to: 'a@b.com', code: '123456', lang: 'en', guildName: 'x' }, { fetcher: fetcher({ ok: true }) }), { ok: false, reason: 'not_configured' });
  Object.assign(config, { resendApiKey: 're_secret', resendFrom: 'Petto <verify@petto.sbs>' });
  assert.deepEqual(await resendReal.sendCodeEmail({ to: 'a@b.com', code: '123456', lang: 'en', guildName: 'x' }, { fetcher: fetcher({ ok: true }) }), { ok: true });
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual([calls[0].url, calls[0].options.headers.Authorization, body.from, body.to], ['https://api.resend.com/emails', 'Bearer re_secret', 'Petto <verify@petto.sbs>', ['a@b.com']]);
  assert.equal((await resendReal.sendCodeEmail({ to: 'a@b.com', code: '1', lang: 'en', guildName: 'x' }, { fetcher: fetcher({ ok: false, status: 422, json: async () => ({ message: 'domain not verified' }) }) })).reason, 'rejected');
  assert.equal((await resendReal.sendCodeEmail({ to: 'a@b.com', code: '1', lang: 'en', guildName: 'x' }, { fetcher: fetcher(new Error('offline')) })).reason, 'unreachable');
  Object.assign(config, { resendApiKey: null, resendFrom: null });

  // --- the Discord account
  const now = Date.now();
  const user = (extra = {}) => ({ id: '1', avatar: 'abc', createdTimestamp: now - 30 * 86_400_000, ...extra });
  const rulesOf = (extra) => normalizeChecks({ account: { mode: 'block', ...extra } }).account;
  assert.deepEqual(accountReasons(user(), rulesOf({ min_age_days: 7 }), { now }), []);
  assert.deepEqual(accountReasons(user({ createdTimestamp: now - 2 * 86_400_000 }), rulesOf({ min_age_days: 7 }), { now }), [{ code: 'young', days: 2, min: 7 }]);
  assert.deepEqual(accountReasons(user({ avatar: null }), rulesOf({ no_avatar: true }), { now }), [{ code: 'noAvatar' }]);
  assert.deepEqual(accountReasons(user({ avatar: null }), rulesOf({ no_avatar: false }), { now }), []);
  assert.deepEqual(accountReasons(user(), rulesOf({}), { now, flags: new UserFlagsBitField(UserFlags.Spammer) }), [{ code: 'flagged' }]);
  assert.deepEqual(accountReasons(user(), rulesOf({}), { now, flags: new UserFlagsBitField(UserFlags.Quarantined) }), [{ code: 'flagged' }]);
  assert.deepEqual(accountReasons(user(), rulesOf({ flagged: false }), { now, flags: new UserFlagsBitField(UserFlags.Spammer) }), []);
  assert.deepEqual(accountReasons(user(), rulesOf({}), { now, flags: null }), [], 'when Discord does not answer the flags are skipped');
  assert.deepEqual(accountReasons(user({ avatar: null }), normalizeChecks({ account: { mode: 'off', no_avatar: true } }).account, { now }), [], 'off is off');

  // --- evaluate: block or warn, and what needs a connection is skipped inside Discord
  const guild = { id: 'g1' };
  const member = { id: 'm1', user: user({ createdTimestamp: now - 86_400_000 }) };
  const deps = (extra = {}) => ({ torHas: (ip) => ip === '203.0.113.7', flagsOf: async () => null, signals: signalStore, banned: async () => false, ...extra });
  let out = await evaluate({ checks: normalizeChecks({ tor: 'block' }), guild, member, ip: '203.0.113.7', deps: deps() });
  assert.deepEqual([out.block.length, out.warn.length, out.block[0].code], [1, 0, 'tor']);
  out = await evaluate({ checks: normalizeChecks({ tor: 'warn' }), guild, member, ip: '203.0.113.7', deps: deps() });
  assert.deepEqual([out.block.length, out.warn.length], [0, 1], 'warn is not a block');
  out = await evaluate({ checks: normalizeChecks({ tor: 'block' }), guild, member, ip: '198.18.0.1', deps: deps() });
  assert.deepEqual([out.block.length, out.warn.length], [0, 0], 'a normal connection passes');
  out = await evaluate({ checks: normalizeChecks({ tor: 'block' }), guild, member, ip: null, deps: deps() });
  assert.deepEqual([out.block.length, out.warn.length], [0, 0], 'no connection (inside Discord): Tor is skipped');
  out = await evaluate({ checks: normalizeChecks({ account: { mode: 'block', min_age_days: 7 } }), guild, member, deps: deps() });
  assert.deepEqual([out.block[0].check, out.block[0].code, out.block[0].min], ['account', 'young', 7]);
  out = await evaluate({ checks: normalizeChecks({ tor: 'warn', account: { mode: 'block', min_age_days: 7 } }), guild, member, ip: '203.0.113.7', deps: deps() });
  assert.deepEqual([out.block.length, out.warn.length], [1, 1], 'each check has its own mode');
  signalRows.clear();
  await signalStore.record({ guildId: 'g1', userId: 'old', ipHash: signalHash('g1', 'ip', '198.18.0.9'), emailHash: signalHash('g1', 'email', 'x@y.com') });
  out = await evaluate({ checks: normalizeChecks({ alt: 'block' }), guild, member, ip: '198.18.0.9', deps: deps({ banned: async (g, id) => id === 'old' }) });
  assert.deepEqual([out.block[0].code, out.alts], ['alt', [{ userId: 'old', by: 'ip', banned: true }]]);
  out = await evaluate({ checks: normalizeChecks({ alt: 'warn' }), guild, member, ip: '198.18.0.55', emailHash: signalHash('g1', 'email', 'x@y.com'), deps: deps() });
  assert.deepEqual([out.warn.length, out.alts[0].by], [1, 'email'], 'the same email in another connection');
  out = await evaluate({ checks: normalizeChecks({ alt: 'block' }), guild, member, ip: '198.18.0.77', deps: deps() });
  assert.deepEqual([out.block.length, out.alts.length], [0, 0], 'a new connection is nobody\'s alt');
  out = await evaluate({ checks: normalizeChecks({ alt: 'block' }), guild: { id: 'g2' }, member, ip: '198.18.0.9', deps: deps() });
  assert.equal(out.block.length, 0, 'what another server saw does not count');

  // --- the job
  const { pass } = require('../src/jobs/verifyChecksJob');
  assert.deepEqual(await pass({ refresh: async () => 1200, purge: async () => 3 }), { addresses: 1200, purged: 3 });
  assert.deepEqual(await pass({ refresh: async () => 0, purge: async () => { throw new Error('db down'); } }), { addresses: 0, purged: 0 }, 'a failing clean-up does not stop it');

  // --- the page
  const withEmail = renderVerifyPage({ token: 't', siteKey: 'k', method: 'both', guildName: 'Petto HQ', emailRequired: true, lang: 'es' });
  assert.ok(withEmail.includes('id="email-box"') && withEmail.includes('Confirma tu correo') && withEmail.includes('"emailSend":"Enviar código"') && withEmail.includes('const USE_EMAIL = true'));
  new Function(withEmail.split('<script>').pop().split('</script>')[0]); // the script of the page parses
  const without = renderVerifyPage({ token: 't', siteKey: 'k', method: 'letters', guildName: 'Petto HQ', lang: 'en' });
  assert.ok(!without.includes('id="email-box"') && without.includes('const USE_EMAIL = false'), 'no email box when the server does not ask');
  assert.ok(renderVerifyPage({ token: 't', siteKey: 'k', method: 'letters', emailRequired: true, lang: 'pt-BR' }).includes('Confirme seu e-mail'));
  assert.ok(withEmail.includes('Usa tu correo de Gmail, Outlook, Hotmail'), 'the page says which providers are accepted');
  assert.ok(renderVerifyPage({ token: 't', siteKey: 'k', method: 'letters', emailRequired: true, emailDomains: ['school.edu'], lang: 'en' }).includes('This server accepts emails from: school.edu'), 'or which domains the server chose');

  // --- the command
  const { checksLines } = require('../src/commands/config/verify');
  const lang = 'en';
  let text = checksLines(normalizeChecks({}), lang, { method: 'turnstile' }).join('\n');
  assert.ok(text.includes('Verification checks') && text.includes('**Tor:** Off') && text.includes('**Email code:** Off') && !text.includes('Email domains'));
  resendOn = false;
  text = checksLines(normalizeChecks({ tor: 'block', alt: 'warn', account: { mode: 'warn', min_age_days: 7, no_avatar: true }, email: { required: true, allowed_domains: ['school.edu'] } }), 'es', { method: 'turnstile' }).join('\n');
  assert.ok(text.includes('**Tor:** Bloquear') && text.includes('Avisar al staff') && text.includes('de al menos 7 día(s)') && text.includes('solo school.edu'), 'Spanish');
  assert.ok(!/resend/i.test(text), 'the admins are not told about the key of the email service: that is for whoever runs Petto');
  text = checksLines(normalizeChecks({ email: { required: true } }), 'es', { method: 'turnstile' }).join('\n');
  assert.ok(text.includes('solo proveedores conocidos (Gmail, Outlook'), 'by default only well-known providers');
  resendOn = true;
  text = checksLines(normalizeChecks({ tor: 'block' }), lang, { method: 'discord' }).join('\n');
  assert.ok(text.includes('verification page'), 'Tor with the letters inside Discord and no page is told');

  // --- the whole way through the HTTP routes
  const GUILD = '111111111111111111';
  const USER = '333333333333333333';
  let memberUser = { id: USER, username: 'newbie', avatar: 'av', createdTimestamp: now - 90 * 86_400_000, fetchFlags: async () => null };
  const bans = new Set();
  const guilds = new Map([[GUILD, { id: GUILD, name: 'Petto HQ', iconURL: () => null, members: { fetch: async () => ({ id: USER, user: memberUser }), cache: new Map() }, bans: { fetch: async ({ user: id }) => { if (!bans.has(id)) throw new Error('Unknown Ban'); return {}; } }, channels: { cache: new Map() } }]]);
  const client = { guilds: { cache: guilds, fetch: async (id) => guilds.get(id) }, users: { fetch: async () => null } };
  const app = startServer(client);
  const server = http.createServer(app).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  let visitor = 0; // each call comes from another address unless the test says which: the routes have a limit for each visitor
  const call = (method, url, { body, headers: given = {} } = {}) => new Promise((resolve, reject) => {
    const headers = { 'x-forwarded-for': `192.0.2.${(visitor += 1) % 250 + 1}`, ...given };
    const data = body === undefined ? null : JSON.stringify(body);
    const request = http.request({ host: '127.0.0.1', port, method, path: url, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let textBody = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { textBody += chunk; });
      res.on('end', () => { let json = null; try { json = JSON.parse(textBody); } catch { /* a page */ } resolve({ status: res.statusCode, text: textBody, json, headers: res.headers }); });
    });
    request.on('error', reject); if (data) request.write(data); request.end();
  });
  const fresh = () => { claimed.clear(); applied.length = 0; logs.length = 0; sent.length = 0; signalRows.clear(); emailCode.reset(); return createToken({ userId: USER, guildId: GUILD }); };
  const verify = (token, headers = {}) => call('POST', '/api/verify', { body: { token, captchaTicket: 'tk', captchaAnswer: 'ABCDE' }, headers });
  resendOn = true;

  // Nothing on: the member verifies as before.
  settings = { method: 'letters', unverified_role_id: 'un', verified_role_id: 'ok', checks: {} };
  let token = fresh();
  let res = await verify(token);
  assert.deepEqual([res.status, res.json.ok, applied.length], [200, true, 1], 'no checks: as before');
  assert.deepEqual(logs.map((l) => l.kind), ['passed']);

  // The email code.
  settings = { ...settings, checks: { email: { required: true } } };
  token = fresh();
  res = await call('GET', `/verify/${token}`);
  assert.ok(res.text.includes('id="email-box"'), 'the page asks for the email');
  res = await verify(token);
  assert.deepEqual([res.status, res.json.code], [400, 'email'], 'not verified without the email');
  assert.equal(applied.length, 0);
  res = await call('POST', '/api/verify/email/send', { body: { token, email: 'x@mailinator.com' } });
  assert.deepEqual([res.status, res.json.code], [400, 'custom'], 'a throwaway email is refused');
  res = await call('POST', '/api/verify/email/send', { body: { token, email: 'liam@petto.sbs' } });
  assert.deepEqual([res.status, res.json.code], [400, 'custom'], 'an address of a personal domain is refused');
  assert.ok(res.json.error.includes('Gmail') && res.json.error.includes('Outlook'), 'and the member is told which providers are accepted');
  res = await call('POST', '/api/verify/email/send', { body: { token, email: 'Jane.Doe+x@gmail.com' } });
  assert.deepEqual([res.status, res.json.code], [400, 'alias'], 'a + is refused');
  res = await call('POST', '/api/verify/email/send', { body: { token, email: 'nonsense' } });
  assert.equal(res.json.code, 'invalid');
  assert.equal(sent.length, 0, 'nothing was sent for those');
  res = await call('POST', '/api/verify/email/confirm', { body: { token, code: '123456' } });
  assert.equal(res.json.code, 'none', 'no code yet');
  res = await call('POST', '/api/verify/email/send', { body: { token, email: 'Jane.Doe@Gmail.com' } });
  assert.deepEqual([res.status, res.json.ok, sent.length, sent[0].to], [200, true, 1, 'jane.doe@gmail.com']);
  assert.match(sent[0].code, /^\d{6}$/);
  res = await call('POST', '/api/verify/email/send', { body: { token, email: 'Jane.Doe@Gmail.com' } });
  assert.deepEqual([res.status, res.json.code], [429, 'cooldown'], 'a second code right away is refused');
  const wrongCode = sent[0].code === '000000' ? '111111' : '000000';
  res = await call('POST', '/api/verify/email/confirm', { body: { token, code: wrongCode } });
  assert.deepEqual([res.status, res.json.code], [400, 'wrong']);
  res = await verify(token);
  assert.equal(res.json.code, 'email', 'a wrong code does not open the door');
  res = await call('POST', '/api/verify/email/confirm', { body: { token, code: sent[0].code } });
  assert.deepEqual([res.status, res.json.ok], [200, true]);
  res = await verify(token);
  assert.deepEqual([res.status, res.json.ok, applied.length], [200, true, 1], 'with the email confirmed the member verifies');
  assert.equal(emailCode.confirmedEmail(createTokenJti(token)), null, 'and the confirmation is spent');
  res = await call('POST', '/api/verify/email/confirm', { body: { token: 'nonsense', code: '123456' } });
  assert.equal(res.status, 400);
  // The email for a server that does not ask, and a server that asks while Petto cannot send.
  settings = { ...settings, checks: {} };
  token = fresh();
  res = await call('POST', '/api/verify/email/send', { body: { token, email: 'a@gmail.com' } });
  assert.deepEqual([res.status, res.json.code], [400, 'notAsked']);
  settings = { ...settings, checks: { email: { required: true } } };
  resendOn = false;
  token = fresh();
  res = await call('GET', `/verify/${token}`);
  assert.ok(!res.text.includes('id="email-box"'), 'without Resend the page does not ask for the email');
  res = await verify(token);
  assert.deepEqual([res.status, res.json.ok], [200, true], 'and nobody is locked out');
  assert.ok(warned.some((w) => w.includes('RESEND_API_KEY')), 'it is said once in the log');
  resendOn = true;

  // "Use my Discord email": the login with Discord gives the address, the code goes to it, and nobody can use another account's email.
  const discordEmailModule = require('../src/utils/discordEmail');
  const realFetch = globalThis.fetch;
  const discordCalls = [];
  let discordUser = { id: USER, email: 'Jane.Doe@Gmail.com', verified: true };
  globalThis.fetch = async (url, options = {}) => {
    discordCalls.push({ url: String(url), options });
    if (String(url).endsWith('/oauth2/token')) return { ok: options.body.includes('code=good'), json: async () => ({ access_token: 'acc' }) };
    if (String(url).endsWith('/users/@me')) return { ok: true, json: async () => discordUser };
    if (String(url).endsWith('/oauth2/token/revoke')) return { ok: true, json: async () => ({}) };
    return realFetch(url, options);
  };
  settings = { ...settings, checks: { email: { required: true } } };
  Object.assign(config, { clientId: '123456789012345678', discordClientSecret: null });
  token = fresh();
  res = await call('GET', `/verify/${token}`);
  assert.ok(!res.text.includes('id="discord-email"'), 'without the secret of the application the page only offers to type the email');
  assert.equal(discordEmailModule.configured(), false);
  Object.assign(config, { discordClientSecret: 'app-secret' });
  assert.equal(discordEmailModule.configured(), true);
  res = await call('GET', `/verify/${token}`);
  assert.ok(res.text.includes('id="discord-email"') && res.text.includes(`/api/verify/discord/start?token=${encodeURIComponent(token)}`) && res.text.includes('id="email-input"'), 'both ways: the Discord button and the box to type it');
  res = await call('GET', `/api/verify/discord/start?token=${encodeURIComponent(token)}`);
  const authorize = new URL(res.headers?.location ?? '', 'https://x');
  assert.equal(res.status, 302);
  assert.deepEqual([authorize.origin + authorize.pathname, authorize.searchParams.get('client_id'), authorize.searchParams.get('scope'), authorize.searchParams.get('state'), authorize.searchParams.get('redirect_uri')], ['https://discord.com/oauth2/authorize', '123456789012345678', 'identify email', token, 'https://verify.example/api/verify/discord/callback']);
  res = await call('GET', '/api/verify/discord/start?token=nonsense');
  assert.equal(res.status, 400, 'a bad link does not start a login');
  const back = async (query) => { const r = await call('GET', `/api/verify/discord/callback?${query}`); return { status: r.status, to: r.headers?.location ?? '' }; };
  let result = await back(`code=good&state=${encodeURIComponent(token)}`);
  assert.deepEqual([result.status, result.to, sent.length, sent[0]?.to], [302, `/verify/${encodeURIComponent(token)}?m=sent`, 1, 'jane.doe@gmail.com'], 'the code goes to the email of the account');
  assert.ok(discordCalls.some((c) => c.url.endsWith('/oauth2/token/revoke')), 'the access is revoked once the email is read');
  assert.ok(discordCalls.find((c) => c.url.endsWith('/users/@me')).options.headers.Authorization === 'Bearer acc');
  res = await call('GET', `/verify/${token}?m=sent`);
  assert.ok(res.text.includes('j***@gmail.com') && !res.text.includes('jane.doe@gmail.com'), 'the page tells where the code went, with the address hidden');
  res = await call('POST', '/api/verify/email/confirm', { body: { token, code: sent[0].code } });
  assert.equal(res.json.ok, true);
  res = await verify(token);
  assert.deepEqual([res.status, res.json.ok, applied.length], [200, true, 1], 'with the Discord email confirmed the member verifies');
  // Another account, no email, an email that is not accepted, a refusal and a failure.
  token = fresh();
  discordUser = { id: '999', email: 'someone@gmail.com', verified: true };
  result = await back(`code=good&state=${encodeURIComponent(token)}`);
  assert.deepEqual([result.to.endsWith('?m=discordOther'), sent.length], [true, 0], 'the account has to be the one the link was made for');
  discordUser = { id: USER, email: 'jane@gmail.com', verified: false };
  assert.ok((await back(`code=good&state=${encodeURIComponent(token)}`)).to.endsWith('?m=discordNoEmail'), 'Discord has not verified the email');
  discordUser = { id: USER, email: null, verified: true };
  assert.ok((await back(`code=good&state=${encodeURIComponent(token)}`)).to.endsWith('?m=discordNoEmail'), 'no email');
  discordUser = { id: USER, email: 'liam@petto.sbs', verified: true };
  assert.ok((await back(`code=good&state=${encodeURIComponent(token)}`)).to.endsWith('?m=custom'), 'the same rules as the typed email: a personal domain is refused');
  res = await call('GET', `/verify/${token}?m=custom`);
  assert.ok(res.text.includes('Gmail') && res.text.includes('"sent":false'), 'and the page says why');
  assert.equal(sent.length, 0);
  assert.ok((await back(`error=access_denied&state=${encodeURIComponent(token)}`)).to.endsWith('?m=discordDenied'), 'the member said no');
  assert.ok((await back(`code=bad&state=${encodeURIComponent(token)}`)).to.endsWith('?m=discordFailed'), 'Discord refused the code');
  assert.equal((await back('code=good&state=nonsense')).status, 400, 'a state that is not a signed link');
  res = await call('GET', `/verify/${token}?m=%3Cscript%3E`);
  assert.ok(!res.text.includes('<script>alert') && res.text.includes('const NOTICE = null'), 'only known notices are shown');
  settings = { ...settings, checks: {} };
  assert.ok((await back(`code=good&state=${encodeURIComponent(token)}`)).to.endsWith('?m=discordFailed'), 'a server that does not ask for the email');
  settings = { ...settings, checks: { email: { required: true } } };
  globalThis.fetch = realFetch;
  Object.assign(config, { clientId: process.env.DISCORD_CLIENT_ID, discordClientSecret: null });

  // Tor: the visitor's address comes from X-Forwarded-For (one proxy is trusted).
  settings = { ...settings, checks: { tor: 'block' } };
  token = fresh();
  res = await verify(token, { 'x-forwarded-for': '203.0.113.7' });
  assert.deepEqual([res.status, res.json.code, applied.length, logs.map((l) => l.kind)], [400, 'blocked', 0, ['blocked']], 'Tor is stopped before anything is changed');
  assert.ok(res.json.error.includes('Tor'));
  assert.equal(claimed.size, 0, 'the link is not used up: the member can try again without Tor');
  res = await verify(token, { 'x-forwarded-for': '198.18.0.1' });
  assert.deepEqual([res.status, res.json.ok, applied.length], [200, true, 1], 'the same link works from a normal connection');
  settings = { ...settings, checks: { tor: 'warn' } };
  token = fresh();
  res = await verify(token, { 'x-forwarded-for': '203.0.113.7' });
  assert.deepEqual([res.status, res.json.ok, logs.map((l) => `${l.kind}${l.codes ? `:${l.codes}` : ''}`)], [200, true, ['passed', 'warned:tor']], 'warn: verified, and the staff is told');

  // Alt accounts: the second member from the same connection.
  settings = { ...settings, checks: { alt: 'block' } };
  token = fresh();
  await signalStore.record({ guildId: GUILD, userId: 'banned-one', ipHash: signalHash(GUILD, 'ip', '198.18.0.50') });
  bans.add('banned-one');
  res = await verify(token, { 'x-forwarded-for': '198.18.0.50' });
  assert.deepEqual([res.status, res.json.code, applied.length], [400, 'blocked', 0]);
  assert.ok(res.json.error.includes('moderator') && !res.json.error.includes('banned'), 'the member is not told who');
  res = await verify(token, { 'x-forwarded-for': '198.18.0.51' });
  assert.deepEqual([res.status, res.json.ok], [200, true], 'another connection passes');
  assert.ok(signalRows.get(`${GUILD}:${USER}`)?.ipHash, 'and its signal is kept for the next one');
  assert.ok(![...signalRows.values()].some((row) => JSON.stringify(row).includes('198.18.0.51')), 'never the address itself');
  settings = { ...settings, checks: {} };
  token = fresh();
  res = await verify(token, { 'x-forwarded-for': '198.18.0.52' });
  assert.equal(signalRows.size, 0, 'with the check off nothing is kept');

  // The Discord account.
  memberUser = { ...memberUser, createdTimestamp: now - 2 * 86_400_000 };
  settings = { ...settings, checks: { account: { mode: 'block', min_age_days: 7 } } };
  token = fresh();
  res = await verify(token);
  assert.deepEqual([res.status, res.json.code, applied.length], [400, 'blocked', 0]);
  assert.ok(res.json.error.includes('7 days'), 'it says how old the account has to be');
  settings = { ...settings, checks: { account: { mode: 'warn', min_age_days: 7 } } };
  token = fresh();
  res = await verify(token);
  assert.deepEqual([res.status, res.json.ok, logs.map((l) => l.kind)], [200, true, ['passed', 'warned']]);
  memberUser = { ...memberUser, createdTimestamp: now - 90 * 86_400_000, avatar: null };
  settings = { ...settings, checks: { account: { mode: 'block', no_avatar: true } } };
  token = fresh();
  res = await verify(token);
  assert.equal(res.status, 400);
  memberUser = { ...memberUser, avatar: 'av', fetchFlags: async () => new UserFlagsBitField(UserFlags.Spammer) };
  settings = { ...settings, checks: { account: { mode: 'block' } } };
  token = fresh();
  res = await verify(token);
  assert.deepEqual([res.status, res.json.code], [400, 'blocked'], 'a flagged account is stopped');
  memberUser = { ...memberUser, fetchFlags: async () => null };

  // The language of the answers follows the visitor.
  settings = { ...settings, checks: { tor: 'block' } };
  token = fresh();
  res = await verify(token, { 'x-forwarded-for': '203.0.113.7', 'accept-language': 'es' });
  assert.ok(res.json.error.includes('Tor') && res.json.error.includes('servidor'), 'Spanish');

  server.close();
  console.log('check-verify-checks: ok');
  process.exit(0);

  function createTokenJti(tokenText) { return require('../src/utils/verifyToken').verifyToken(tokenText).jti; }
})().catch((error) => { console.error(error); process.exit(1); });
