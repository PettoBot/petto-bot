// Checks timers that post at a time of day (every day, or every week on a weekday) in a time zone: the next run across daylight
// saving changes, a time already passed today, weekly on the same weekday, the `!timer add` text, and what the dashboard may write.
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';

const {
  nextScheduledRun, nextRunAt, normalizeTimeZone, normalizeTime, parseWeekday, parseScheduleText, normalizeScheduleFields,
} = require('../src/utils/timerSchedule');
const { parseDuration } = require('../src/utils/duration');

const at = (iso) => Date.parse(iso);
const next = (timer, iso) => nextScheduledRun(timer, at(iso))?.toISOString();

// Every day at a time.
const bogota = { schedule: 'daily', at_time: '18:00', timezone: 'America/Bogota' };
assert.equal(next(bogota, '2026-10-29T12:00:00Z'), '2026-10-29T23:00:00.000Z', 'later today when the time has not come yet');
assert.equal(next(bogota, '2026-10-29T23:00:00Z'), '2026-10-30T23:00:00.000Z', 'tomorrow once the time came (strictly after)');
assert.equal(next(bogota, '2026-10-29T23:30:00Z'), '2026-10-30T23:00:00.000Z', 'tomorrow when the time already passed today');

// Daylight saving: New York moves forward on 2026-03-08 and back on 2026-11-01; Madrid moves back on 2026-10-25.
const ny = { schedule: 'daily', at_time: '09:00', timezone: 'America/New_York' };
assert.equal(next(ny, '2026-03-07T15:00:00Z'), '2026-03-08T13:00:00.000Z', '09:00 EDT the day the clocks go forward');
assert.equal(next(ny, '2026-03-06T15:00:00Z'), '2026-03-07T14:00:00.000Z', '09:00 EST the day before');
assert.equal(next(ny, '2026-10-31T15:00:00Z'), '2026-11-01T14:00:00.000Z', '09:00 EST the day the clocks go back');
assert.equal(next({ ...ny, at_time: '02:30' }, '2026-03-07T15:00:00Z'), '2026-03-08T07:30:00.000Z', 'a skipped time moves forward to 03:30 EDT');
assert.equal(next({ ...ny, at_time: '01:30' }, '2026-10-31T15:00:00Z'), '2026-11-01T05:30:00.000Z', 'a repeated time is the first one');
const madrid = { schedule: 'daily', at_time: '09:30', timezone: 'Europe/Madrid' };
assert.equal(next(madrid, '2026-10-24T08:00:00Z'), '2026-10-25T08:30:00.000Z', 'CET after the change');
assert.equal(next(madrid, '2026-10-23T08:00:00Z'), '2026-10-24T07:30:00.000Z', 'CEST before the change');

// Every week on a weekday (2026-10-29 is a Thursday).
const thursday = { schedule: 'weekly', weekday: 4, at_time: '09:30', timezone: 'Europe/Madrid' };
assert.equal(next(thursday, '2026-10-29T07:00:00Z'), '2026-10-29T08:30:00.000Z', 'the same weekday, before the time: today');
assert.equal(next(thursday, '2026-10-29T09:00:00Z'), '2026-11-05T08:30:00.000Z', 'the same weekday, after the time: next week');
assert.equal(next({ ...thursday, weekday: 1 }, '2026-10-29T09:00:00Z'), '2026-11-02T08:30:00.000Z', 'another weekday: the next one');
// The weekday is the zone's, not UTC's: Monday 20:00 in Bogota is Tuesday 01:00 UTC.
assert.equal(next({ schedule: 'weekly', weekday: 1, at_time: '20:00', timezone: 'America/Bogota' }, '2026-10-29T00:00:00Z'), '2026-11-03T01:00:00.000Z');

// Fixed offsets.
assert.equal(next({ schedule: 'daily', at_time: '10:00', timezone: 'UTC+5:30' }, '2026-10-29T09:00:00Z'), '2026-10-30T04:30:00.000Z');
assert.equal(next({ schedule: 'daily', at_time: '10:00', timezone: 'UTC-5' }, '2026-10-29T09:00:00Z'), '2026-10-29T15:00:00.000Z');

// A run missed while the bot was off: the next one is in the future, not the one(s) missed.
const missed = nextRunAt(bogota, at('2026-11-02T03:00:00Z'));
assert.equal(missed.toISOString(), '2026-11-02T23:00:00.000Z', 'no catch-up after a long time offline');
// Interval timers keep "now + interval".
assert.equal(nextRunAt({ schedule: 'interval', interval_ms: 600_000 }, 1_000).getTime(), 601_000);
assert.equal(nextRunAt({ interval_ms: 600_000 }, 1_000).getTime(), 601_000, 'a row from before the schedule columns');

// Zones, times and weekdays.
assert.equal(normalizeTimeZone('america/bogota'), 'America/Bogota');
assert.equal(normalizeTimeZone('utc'), 'UTC');
assert.equal(normalizeTimeZone('UTC-05:00'), 'UTC-5');
assert.equal(normalizeTimeZone('GMT+5:30'), 'UTC+5:30');
assert.equal(normalizeTimeZone('Mars/Olympus'), null);
assert.equal(normalizeTimeZone('UTC+15'), null);
assert.equal(normalizeTime('9:05'), '09:05');
assert.equal(normalizeTime('24:00'), null);
assert.equal(normalizeTime('18:5'), null);
assert.deepEqual(['monday', 'lunes', 'segunda-feira', 'Sábado', 'domingo', '3'].map(parseWeekday), [1, 1, 1, 6, 0, 3]);
assert.equal(parseWeekday('someday'), null);

// The `!timer add` text.
assert.deepEqual(parseScheduleText('daily 18:00 America/Bogota Hello  there', parseDuration), { schedule: 'daily', intervalMs: 86_400_000, atTime: '18:00', timezone: 'America/Bogota', weekday: null, rest: 'Hello  there' });
assert.deepEqual(parseScheduleText('weekly lunes 9:30 UTC hola', parseDuration), { schedule: 'weekly', intervalMs: 604_800_000, atTime: '09:30', timezone: 'UTC', weekday: 1, rest: 'hola' });
assert.equal(parseScheduleText('daily 18:00 Hello', parseDuration).timezone, 'UTC', 'the zone is optional (UTC)');
assert.equal(parseScheduleText('daily 18:00 Hello', parseDuration).rest, 'Hello');
assert.equal(parseScheduleText('2h Hello', parseDuration).intervalMs, 7_200_000, 'an interval still works');
assert.equal(parseScheduleText('daily 6pm Hello', parseDuration).error, 'time');
assert.equal(parseScheduleText('weekly 18:00 Hello', parseDuration).error, 'weekday');
assert.deepEqual(parseScheduleText('daily 18:00 Mars/Olympus Hello', parseDuration), { error: 'timezone', zone: 'Mars/Olympus' });
assert.equal(parseScheduleText('Hello', parseDuration), null);

// What the dashboard may write.
const written = normalizeScheduleFields({ schedule: 'weekly', at_time: '9:30', timezone: 'europe/madrid', weekday: '4', interval_ms: 600_000 }, { now: at('2026-10-29T09:00:00Z') });
assert.deepEqual(written.row, { schedule: 'weekly', at_time: '09:30', timezone: 'Europe/Madrid', weekday: 4, interval_ms: 604_800_000, next_run_at: '2026-11-05T08:30:00.000Z' });
assert.equal(normalizeScheduleFields({ schedule: 'hourly' }).error, 'schedule');
assert.equal(normalizeScheduleFields({ schedule: 'daily', at_time: 'x' }).error, 'time');
assert.equal(normalizeScheduleFields({ schedule: 'daily', at_time: '10:00', timezone: 'Nope/Zone' }).error, 'timezone');
assert.equal(normalizeScheduleFields({ schedule: 'weekly', at_time: '10:00', weekday: 9 }).error, 'weekday');
assert.deepEqual(normalizeScheduleFields({ schedule: 'interval', at_time: '10:00', weekday: 2, interval_ms: 600_000 }).row, { schedule: 'interval', at_time: null, weekday: null, interval_ms: 600_000 });

const { prepareTimerWrite } = require('../src/web/dashboardDatabase');
assert.deepEqual(prepareTimerWrite({ message: 'only the text' }), { body: { message: 'only the text' } }, 'a change without schedule fields is left alone');
assert.equal(prepareTimerWrite({ timezone: 'UTC' }).error, 'schedule', 'part of a schedule is refused');
assert.equal(prepareTimerWrite([{ schedule: 'daily', at_time: '25:00' }]).error, 'time');
assert.equal(prepareTimerWrite({ schedule: 'daily', at_time: '10:00', timezone: 'UTC' }).body.interval_ms, 86_400_000);

// The schema keeps the columns idempotent and the check valid for scheduled rows.
const schema = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
for (const column of ['schedule', 'at_time', 'timezone', 'weekday']) assert.match(schema, new RegExp(`alter table auto_messages add column if not exists ${column} `));
assert.match(schema, /alter table auto_messages drop constraint if exists auto_messages_schedule_check;/);
for (const column of ['number', 'last_error', 'paused']) assert.match(schema, new RegExp(`alter table auto_messages add column if not exists ${column} `));
assert.match(schema, /create unique index if not exists auto_messages_guild_number on auto_messages \(guild_id, number\);/);
assert.match(schema, /row_number\(\) over \(partition by a\.guild_id order by a\.id\)/, 'old timers are numbered per server in the order they were made');

// A Components V2 saved embed with the timer's text: never `content` (Discord refuses the whole message), the text goes in as its first text.
const { withLeadingText, isRealText } = require('../src/utils/leadingText');
const v2 = { content: undefined, embeds: [], components: [{ type: 17, components: [{ type: 10, content: 'Eliana' }] }], files: [], flags: 1 << 15 };
for (const message of ['.', ',', ' ', '', null]) {
  const sent = withLeadingText(v2, message);
  assert.equal('content' in sent, false, `a V2 timer with "${message}" sends no content`);
  assert.equal(sent.components.length, 1, `"${message}" says nothing, so nothing is added`);
}
const withWords = withLeadingText({ ...v2, content: 'from the design' }, 'Good morning <@&123456789012345678>');
assert.equal('content' in withWords, false, 'a V2 design never keeps content');
assert.deepEqual(withWords.components[0], { type: 10, content: 'Good morning <@&123456789012345678>' });
const full = { ...v2, components: Array.from({ length: 40 }, () => ({ type: 10, content: 'x' })) };
assert.equal(withLeadingText(full, 'hello').components.length, 40, 'no text is added past the 40 components of a V2 message');
assert.equal(withLeadingText({ content: undefined, embeds: [{}], components: [] }, 'above').content, 'above', 'a classic embed keeps the text above it');
assert.ok(isRealText('🌸') && isRealText('hola') && isRealText('5') && !isRealText('.,!') && !isRealText(''));

console.log('Checked scheduled timers: next runs in time zones and across daylight saving, the command text and dashboard writes.');
