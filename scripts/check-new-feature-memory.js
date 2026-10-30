// Memory of the newer features: thousands of fake messages, deletions, edits, reactions and links go through the snipe caches, the cooldown
// of the message link embeds and the settings of a server, and every size has to stay under its cap. It runs in about a second.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const rows = new Map();
stub('src/db/database.js', { from: () => { const q = { f: {} }; q.select = () => q; q.eq = (c, v) => { q.f[c] = v; return q; }; q.maybeSingle = async () => ({ data: rows.get(q.f.guild_id) ?? null, error: null }); return q; } });
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });

const cache = require('../src/utils/snipeCache');
const links = require('../src/utils/messageLinks');
const settings = require('../src/db/messageLinks');

const started = Date.now();
const guild = { id: '1' };
const big = 'x'.repeat(5000);
const message = (i, channel) => ({
  id: String(i), guild, channelId: `c${channel}`, content: big, createdTimestamp: i,
  author: { id: `u${i % 500}`, username: `user${i}`, avatar: 'hash', bot: false }, member: null,
  attachments: new Map(Array.from({ length: 20 }, (_, k) => [k, { name: `f${k}.png`, url: `https://cdn.example/${i}/${k}.png` }])),
  embeds: Array.from({ length: 10 }, () => ({ toJSON: () => ({ huge: big }) })),
});
const CHANNELS = 4000;
for (let i = 0; i < 12000; i += 1) {
  const channel = i % CHANNELS;
  const m = message(i, channel);
  cache.rememberKnown(m);
  if (i % 2 === 0) cache.rememberDeleted(m);
  if (i % 3 === 0) cache.rememberEdited({ ...m, content: 'old' }, { ...m, content: `new ${i}` });
  if (i % 4 === 0) cache.rememberReactionRemoved({ emoji: { id: null, name: '👍' }, message: m }, { id: `p${i}`, username: 'p', avatar: 'h', bot: false });
}
const stats = cache.stats();
for (const kind of ['deleted', 'edited', 'reactions']) {
  assert.ok(stats.channels[kind] <= cache.MAX_CHANNELS, `${kind}: ${stats.channels[kind]} channels are kept, at most ${cache.MAX_CHANNELS}`);
  assert.ok(stats.entries[kind] <= cache.MAX_CHANNELS * cache.MAX_ENTRIES_PER_CHANNEL, `${kind}: ${stats.entries[kind]} entries, at most ${cache.MAX_CHANNELS * cache.MAX_ENTRIES_PER_CHANNEL}`);
  assert.ok(stats.channels[kind] > 0, `${kind} is used`);
}
assert.ok(stats.known <= cache.MAX_KNOWN_MESSAGES, `${stats.known} remembered messages, at most ${cache.MAX_KNOWN_MESSAGES}`);
// What is kept is small: the text clipped, the files counted, no embeds.
const sample = cache.getDeleted(`c${(11998) % CHANNELS}`, 1);
assert.ok(sample, 'the latest channels are kept (the oldest went first)');
assert.ok(sample.message.content.length <= cache.CONTENT_LIMIT, 'the text is clipped');
assert.ok(sample.message.attachments.length <= cache.MAX_ATTACHMENTS, 'the files are limited');
assert.equal(sample.message.embedCount, 10);
assert.equal(sample.message.embeds, undefined, 'the embeds themselves are not kept');
assert.ok(JSON.stringify(sample).length < 2500, `an entry is about ${JSON.stringify(sample).length} characters`);
// The oldest channels are the ones gone.
assert.equal(cache.getDeleted('c0', 1), null, 'the channel used longest ago was dropped');
// Entries older than a day are dropped when something is added.
const realNow = Date.now;
Date.now = () => realNow() + cache.MAX_AGE_MS + 1000;
cache.rememberDeleted(message(99999, 99999));
cache.rememberKnown(message(99999, 99999));
assert.equal(cache.stats().channels.deleted, 1, 'a day later only the new one is left');
assert.equal(cache.stats().known, 1, 'and no old remembered message');
Date.now = realNow;

// The cooldown map of the message link embeds.
let clock = 1_000_000;
const limiter = links.createLimiter({ now: () => clock });
for (let i = 0; i < 20000; i += 1) {
  limiter.tryStart(`channel${i}`);
  if (i % 50 === 0) clock += 10; // time passes slowly: many are still running
}
assert.ok(limiter.size() <= links.MAX_COOLDOWN_ENTRIES, `the cooldown map holds ${limiter.size()}, at most ${links.MAX_COOLDOWN_ENTRIES}`);
clock += 5000;
limiter.tryStart('later');
assert.equal(limiter.size(), 1, 'when the cooldowns are over the map empties');

// The switch of each server: small, and a server that has it off is only `false`.
(async () => {
  for (let i = 0; i < settings.MAX_GUILDS + 2000; i += 1) await settings.getSettings(String(100000 + i));
  assert.ok(settings.cachedGuilds() <= settings.MAX_GUILDS, `${settings.cachedGuilds()} servers remembered, at most ${settings.MAX_GUILDS}`);
  assert.equal(await settings.getSettings('100000'), false);
  assert.ok(Date.now() - started < 8000, 'the check is fast');
  console.log(`check-new-feature-memory: ok (channels per kind ${cache.MAX_CHANNELS}, entries per channel ${cache.MAX_ENTRIES_PER_CHANNEL}, remembered messages ${cache.MAX_KNOWN_MESSAGES}, cooldowns ${links.MAX_COOLDOWN_ENTRIES}, servers ${settings.MAX_GUILDS}) in ${Date.now() - started} ms`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
