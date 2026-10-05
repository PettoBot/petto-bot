// Checks how times are read: lengths ("3d 4h"), moments ("tomorrow 8pm") and the {timestamp} variables.
const assert = require('node:assert/strict');
const { parseDuration } = require('../src/utils/duration');
const { parseWhen, discordTimestamp } = require('../src/utils/when');
const { resolve } = require('../src/utils/embedVariables');

const HOUR = 3_600_000; const DAY = 24 * HOUR;
for (const [text, ms] of [['10m', 600000], ['2h', 2 * HOUR], ['7d', 7 * DAY], ['3d 4h', 3 * DAY + 4 * HOUR], ['1h30m', 1.5 * HOUR], ['1 hour and 30 minutes', 1.5 * HOUR], ['2 horas y 15 min', 2 * HOUR + 900000], ['1.5h', 1.5 * HOUR], ['2d,3h', 2 * DAY + 3 * HOUR], ['1 semana', 7 * DAY], ['10', 10]]) {
  assert.equal(parseDuration(text), ms, `duration ${text}`);
}
for (const bad of ['', 'abc', '0', '5x', '-3h', '3d x', null, undefined]) assert.equal(parseDuration(bad), null, `not a duration: ${bad}`);

const now = Date.UTC(2026, 9, 5, 12, 0, 0);
const at = (text) => { const value = parseWhen(text, { now }); return value === null ? null : new Date(value).toISOString(); };
assert.equal(at('in 2h'), '2026-10-05T14:00:00.000Z');
assert.equal(at('en 3d 4h'), '2026-10-08T16:00:00.000Z');
assert.equal(at('tomorrow 8pm'), '2026-10-06T20:00:00.000Z');
assert.equal(at('mañana 20:00'), '2026-10-06T20:00:00.000Z');
assert.equal(at('today 6:30 pm'), '2026-10-05T18:30:00.000Z');
assert.equal(at('tonight'), '2026-10-05T21:00:00.000Z');
assert.equal(at('2026-10-12 18:00'), '2026-10-12T18:00:00.000Z');
assert.equal(at('2026-10-12'), '2026-10-12T00:00:00.000Z');
assert.equal(at('at 8pm'), '2026-10-05T20:00:00.000Z', 'a time of day is the next time the clock shows it');
assert.equal(at('at 9am'), '2026-10-06T09:00:00.000Z');
assert.equal(at('<t:1790000000:R>'), '2026-09-21T14:13:20.000Z');
assert.equal(at('1790000000'), '2026-09-21T14:13:20.000Z');
for (const bad of ['', 'banana', '2026-02-31', 'tomorrow', 'tomorrow 25:00', 'today 13pm']) assert.equal(at(bad), null, `not a moment: ${bad}`);
assert.equal(discordTimestamp(now, 'relative'), '<t:1791201600:R>');
assert.equal(discordTimestamp(now, 'short_datetime'), '<t:1791201600:s>'); assert.equal(discordTimestamp(now, 'S'), '<t:1791201600:S>', 'the newest styles');
assert.equal(discordTimestamp(now, 'nonsense'), '<t:1791201600:f>', 'an unknown style gives the default');

(async () => {
  const text = await resolve('{timestamp.unix} {timestamp.relative} {timestamp:in 2h|R} {timestamp:2026-10-12 18:00|full_long} {timestamp:tomorrow 8pm} {timestamp:nonsense}|', {});
  const [unix, relative, soon, fixed, tomorrow, nonsense] = text.split(' ');
  assert.match(unix, /^\d{10}$/); assert.match(relative, /^<t:\d{10}:R>$/);
  assert.match(soon, /^<t:\d{10}:R>$/); assert.equal(fixed + ' ' + '', '<t:1791828000:F> ');
  assert.match(tomorrow, /^<t:\d{10}:f>$/); assert.equal(nonsense, '|', 'a moment that is not understood leaves nothing');
  console.log('when ok');
})().catch((error) => { console.error(error); process.exit(1); });
