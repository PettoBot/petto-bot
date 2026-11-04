// Every request to Discord goes through one limit that stays under the host's 300 requests in 30 seconds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';
const config = require('../src/config');

assert.ok(config.restRequestsPerSecond >= 1 && config.restRequestsPerSecond * 30 < 300, 'the default leaves room under 300 requests in 30 seconds');
const indexSource = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
assert.ok(/attachSharedRestLimit\(client\.rest, config\.restRequestsPerSecond\)/.test(indexSource), 'the client puts its requests through the gate of utils/sharedRestLimit.js');
assert.ok(/globalRequestsPerSecond: Math\.min\(50, config\.restRequestsPerSecond \* 4\)/.test(indexSource), 'discord.js keeps its own limit only as a net, higher than the gate');
assert.ok(/rejectOnRateLimit/.test(indexSource), 'a request that Discord would hold for a long time fails at once');
console.log('rest limit checks passed');
