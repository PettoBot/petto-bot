// Two things that failed in a real server and are kept from coming back (the log of 2026-11-18):
//   - every category of the logs that can be chosen is allowed by the constraint of `log_entries` (`forums` was missing: the "Audit logs" step of the setup failed);
//   - the creation of the AutoMod rules waits and tries again when Discord limits it (5 rules per 30 seconds per person): the REST client of the bot rejects at once a wait longer than 15 s with a
//     `RateLimitError` (no status, `timeToReset` in milliseconds), and the rules after the fifth used to fail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const root = path.join(__dirname, '..');

const { EVENTS } = require('../src/db/logConfig');
const schema = fs.readFileSync(path.join(root, 'src/db/schema.sql'), 'utf8');
const constraint = /add constraint log_entries_event_check\s+check \(event in \(([^)]*)\)\)/.exec(schema)?.[1] ?? '';
const allowed = new Set([...constraint.matchAll(/'([a-z]+)'/g)].map((match) => match[1]));
for (const event of EVENTS) assert.ok(allowed.has(event), `the constraint of log_entries does not allow the log category "${event}"`);

const source = fs.readFileSync(path.join(root, 'src/utils/autoModManager.js'), 'utf8');
assert.match(source, /error\?\.name === 'RateLimitError' \|\| Number\(error\?\.timeToReset\) > 0/, 'a RateLimitError is retried');
assert.match(source, /Math\.min\(timeToReset \+ 500, 35_000\)/, 'the wait is what Discord said, with a margin');
console.log('incident-fixes: ok');
