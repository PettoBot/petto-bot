// `!automod link` asks Google Safe Browsing again: the request, a link that is clean, a flagged one that is kept, a known one that is not asked twice,
// no key, Google down, and the second database left alone (the threat lists and their jobs are gone).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkUrl } = require('../src/utils/safeBrowsing');
const { checkLink } = require('../src/utils/linkCheck');

const root = path.join(__dirname, '..');

(async () => {
  // --- the request to Google
  const calls = [];
  const google = (matches, ok = true, status = 200) => async (url, options) => { calls.push({ url, options }); return { ok, status, json: async () => ({ matches }) }; };
  assert.deepEqual(await checkUrl('http://bad.example/x', { key: 'K 1', fetcher: google(undefined) }), [], 'no matches is clean');
  assert.equal(calls[0].url, 'https://safebrowsing.googleapis.com/v4/threatMatches:find?key=K%201', 'the key is in the address, encoded');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.threatInfo.threatEntries, [{ url: 'http://bad.example/x' }]);
  assert.deepEqual(body.threatInfo.threatTypes, ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION']);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(await checkUrl('http://bad.example/x', { key: 'k', fetcher: google([{ threatType: 'MALWARE' }, { threatType: 'MALWARE' }, { threatType: 'SOCIAL_ENGINEERING' }]) }), ['MALWARE', 'SOCIAL_ENGINEERING']);
  await assert.rejects(checkUrl('http://x.example/', { key: null, fetcher: google([]) }), /GOOGLE_SAFE_BROWSING_API_KEY/);
  await assert.rejects(checkUrl('http://x.example/', { key: 'k', fetcher: google([], false, 403) }), /403/);

  // --- the verdict
  const kept = new Map();
  const store = {
    findKnownMalicious: async (urls) => urls.filter((url) => kept.has(url)).map((url) => kept.get(url)),
    recordMaliciousLink: async (entry) => { const row = { normalized_url: entry.url, threat_types: entry.threatTypes, reported_by: entry.reportedBy, first_seen_guild_id: entry.guildId, dev_alerted_at: null }; kept.set(entry.url, row); return row; },
  };
  let asked = 0;
  const ask = (threats) => async () => { asked += 1; if (threats instanceof Error) throw threats; return threats; };
  const context = { reportedBy: '42', guildId: 'g1', channelId: 'c1' };

  assert.deepEqual(await checkLink('http://fine.example/', context, { links: store, checkUrl: ask([]) }), { state: 'clean' });
  assert.equal(kept.size, 0, 'a clean link is not kept');

  let verdict = await checkLink('http://bad.example/', context, { links: store, checkUrl: ask(['SOCIAL_ENGINEERING']) });
  assert.deepEqual([verdict.state, verdict.known, verdict.threats], ['flagged', false, ['SOCIAL_ENGINEERING']]);
  assert.deepEqual([verdict.row.reported_by, verdict.row.first_seen_guild_id], ['42', 'g1'], 'who found it and where is kept');
  assert.equal(asked, 2);

  verdict = await checkLink('http://bad.example/', context, { links: store, checkUrl: ask(new Error('must not ask again')) });
  assert.deepEqual([verdict.state, verdict.known, verdict.threats], ['flagged', true, ['SOCIAL_ENGINEERING']]);
  assert.equal(asked, 2, 'a kept link is not asked to Google again');

  assert.deepEqual(await checkLink('http://other.example/', context, { links: store, checkUrl: ask(new Error('Safe Browsing API returned 500')) }), { state: 'unavailable' });
  assert.deepEqual(await checkLink('http://other.example/', context, { links: store, checkUrl: ask(new Error('GOOGLE_SAFE_BROWSING_API_KEY is not configured.')) }), { state: 'unavailable' }, 'no key');

  // A store that fails does not stop the check: Google is asked, and a flagged link is still reported (without a row).
  const broken = { findKnownMalicious: async () => { throw new Error('db down'); }, recordMaliciousLink: async () => { throw new Error('db down'); } };
  verdict = await checkLink('http://bad2.example/', context, { links: broken, checkUrl: ask(['MALWARE']) });
  assert.deepEqual([verdict.state, verdict.row, verdict.threats], ['flagged', null, ['MALWARE']]);

  // --- the lists and the second database
  for (const gone of ['src/jobs/maliciousFeedJob.js', 'src/jobs/dataMoveJob.js', 'src/db/dataMove.js']) assert.equal(fs.existsSync(path.join(root, gone)), false, `${gone} is gone`);
  assert.ok(!/maliciousFeedJob|dataMoveJob|startMaliciousFeedJob/.test(fs.readFileSync(path.join(root, 'index.js'), 'utf8')), 'the bot starts neither job');
  const secondary = require('../src/db/secondary');
  assert.equal(secondary.SCHEMA.trim(), '', 'no table is made in the second database');
  const config = require('../src/config');
  config.data2DatabaseUrl = 'postgres://nobody:nothing@127.0.0.1:1/never';
  await secondary.ready(); // with a second database set, nothing is sent to it
  config.data2DatabaseUrl = null;
  const links = fs.readFileSync(path.join(root, 'src/db/maliciousLinks.js'), 'utf8');
  assert.ok(!/secondary/.test(links), 'the links are in the main database');
  assert.ok(!/SECONDARY_TABLES/.test(fs.readFileSync(path.join(root, 'src/web/dashboardDatabase.js'), 'utf8')), 'the dashboard route does not know the second database');

  console.log('check-safe-browsing: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
