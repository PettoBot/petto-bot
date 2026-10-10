// Every request to Discord goes through one limit that stays under the host's 300 requests in 30 seconds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';
const config = require('../src/config');

assert.ok(config.restRequestsPerSecond >= 1 && config.restRequestsPerSecond * 30 < 300, 'the default leaves room under 300 requests in 30 seconds');
assert.ok(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8').includes('globalRequestsPerSecond: config.restRequestsPerSecond'), 'the client uses it');
console.log('rest limit checks passed');
