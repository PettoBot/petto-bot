// The ping card: both latencies, the links, the size of Petto and a color that follows how slow it is.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { buildPingCard } = require('../src/commands/info/ping');

const json = (card) => JSON.parse(JSON.stringify(card.toJSON ? card.toJSON() : card));
const text = (card) => JSON.stringify(json(card));

let card = json(buildPingCard({ guildMs: 254, apiMs: 117.8125, shard: 1, shardCount: 1, guilds: 15535 }));
assert.equal(card.type, 17, 'a Components V2 container');
assert.match(text(card), /\*\*Guild Ping:\*\* `254ms`/);
assert.match(text(card), /\*\*API Ping:\*\* `118ms`/, 'the API ping is rounded');
assert.match(text(card), /Status Page/);
assert.match(text(card), /Support Server/);
assert.match(text(card), /Shard 1\/1 • Guilds: 15,535/, 'the number of servers has thousands separators');
assert.doesNotMatch(text(card), /Members|4,891,774/, 'the number of members is private and never shown');
assert.equal(card.accent_color, 0xa5ea7a, '254ms is still fast');
assert.equal(json(buildPingCard({ guildMs: 400, apiMs: 100, shard: 1, shardCount: 1, guilds: 1 })).accent_color, 0xfed53c, 'a slow guild ping is yellow');

assert.equal(json(buildPingCard({ guildMs: 90, apiMs: 60, shard: 1, shardCount: 1, guilds: 1 })).accent_color, 0xa5ea7a, 'fast is green');
assert.equal(json(buildPingCard({ guildMs: 90, apiMs: 900, shard: 1, shardCount: 1, guilds: 1 })).accent_color, 0xff6b6b, 'a slow API makes it red');
const unknown = json(buildPingCard({ guildMs: 100, apiMs: NaN, shard: 2, shardCount: 4, guilds: 3 }));
assert.match(text(unknown), /API Ping:\*\* `N\/A`/, 'no websocket data yet');
assert.match(text(unknown), /Shard 2\/4/);
console.log('ping card ok');
