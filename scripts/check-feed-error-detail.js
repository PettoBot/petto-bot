// Checks what is kept when a feed fails: a line for the Petto team without keys or tokens, and the plain kind that a server sees (so "the last notice could not be sent"
// says which: Discord refused it, Discord did not answer, Petto cannot post there, the channel is gone).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describeError, sendKindOf, redact } = require('../src/feeds/errorDetail');

// ---- the line for the team
const discord = Object.assign(new Error('Invalid Form Body\nembeds[0].description[BASE_TYPE_MAX_LENGTH]: Must be 4096 or fewer in length.'), { name: 'DiscordAPIError', code: 50035, status: 400 });
const line = describeError(discord);
assert.ok(line.startsWith('DiscordAPIError[50035] (400): Invalid Form Body'), line);
assert.ok(!line.includes('\n'), 'one line');
assert.equal(describeError(null), null);
assert.equal(describeError(''), null);
assert.equal(describeError('the channel is gone'), 'the channel is gone');
const integration = Object.assign(new Error('notConfigured: youtube'), { kind: 'notConfigured' });
assert.ok(describeError(integration).includes('notConfigured'), 'the kind of an integration error');
assert.ok(describeError({ message: 'x'.repeat(2000) }).length <= 400, 'a long text is cut');

// ---- keys and tokens never stay
const secret = describeError(new Error('GET https://www.googleapis.com/youtube/v3/channels?part=id&key=AIzaSyA1234567890abcdefghijklmnopqrstuv failed: 403 quotaExceeded'));
assert.ok(!/AIza|1234567890abcdef/.test(secret) && secret.includes('key=[hidden]') && secret.includes('403 quotaExceeded'), secret);
assert.ok(!redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789').includes('abcdefghijkl'), 'a bearer token');
assert.ok(!redact('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789').includes('ghp_abcdef'), 'a token in the address');
assert.ok(!redact('secret 0123456789abcdef0123456789abcdef0123456789abcdef').includes('0123456789abcdef0123'), 'a long random string');
assert.equal(redact('Missing Permissions 50013 in channel 1234567890'), 'Missing Permissions 50013 in channel 1234567890', 'the rest is left as it is');

// ---- what a server sees
const err = (props) => Object.assign(new Error(props.message ?? 'x'), props);
assert.equal(sendKindOf(err({ code: 10003 })), 'channelGone');
assert.equal(sendKindOf(err({ code: 50013 })), 'permission');
assert.equal(sendKindOf(err({ code: 50001 })), 'permission');
assert.equal(sendKindOf(err({ code: 50035 })), 'sendRejected', 'Discord refused the content');
assert.equal(sendKindOf(err({ code: 50006 })), 'sendRejected', 'an empty message');
assert.equal(sendKindOf(err({ status: 429 })), 'sendBusy');
assert.equal(sendKindOf(err({ status: 503 })), 'sendBusy');
assert.equal(sendKindOf(err({ name: 'TimeoutError' })), 'sendBusy');
assert.equal(sendKindOf(err({ message: 'The bot is under pressure and this background request to Discord was not sent.' })), 'sendBusy');
assert.equal(sendKindOf(err({ message: 'something nobody expected', code: 12345 })), 'send');
assert.equal(sendKindOf(null), 'send');

// ---- a feed that turns itself off is told to the server, in its language, with a plain reason
const { renderNotice, TEMPLATES } = require('../src/utils/guildOpsAlerts');
const { t } = require('../src/i18n');
assert.ok(TEMPLATES.feedOff, 'the kind exists (the team can also send it with !guildsend)');
for (const [lang, title, resume] of [['en', 'Petto turned off a feed', 'Resume'], ['es', 'Petto apagó un feed', 'Reanudar'], ['pt-BR', 'O Petto desligou um feed', 'Retomar']]) {
  const details = t(lang, 'feeds.off.details', { account: 'Discord Developers', platform: 'youtube', count: 5, reason: t(lang, 'feeds.off.reason.sendRejected') });
  const card = renderNotice({ kind: 'feedOff', details, lang });
  assert.ok(card.includes(title) && card.includes(resume) && card.includes('Discord Developers') && card.includes('5'), `${lang}: the notice says which feed, how many times and what to press`);
  for (const reason of ['permission', 'channelGone', 'sendRejected', 'sendBusy', 'send', 'accountGone', 'blocked', 'rateLimited', 'noFeed', 'unavailable', 'unknown']) {
    assert.ok(t(lang, `feeds.off.reason.${reason}`) && !t(lang, `feeds.off.reason.${reason}`).startsWith('feeds.off.'), `${lang}: a plain reason for ${reason}`);
  }
}
const engine = fs.readFileSync(path.join(__dirname, '..', 'src/feeds/engine.js'), 'utf8');
assert.ok(/turnedOff = failures >= FAILURES_TO_STOP && feed\.enabled !== false/.test(engine) && /tellFeedOff\(feed, kind\)/.test(engine), 'it is told once, when the feed goes from on to off');
console.log('Feed error detail checks passed (the line for the team, no secrets, the reason a server sees).');
