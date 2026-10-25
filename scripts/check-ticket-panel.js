// The look of a ticket panel (color, picture, footer, dropdown text) and the hours of the staff.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const cards = require('../src/utils/ticketCards');
const { isWithinHours, outsideHoursText, isValidTimezone, toMinutes } = require('../src/utils/ticketHours');

const json = (card) => JSON.parse(JSON.stringify(card.toJSON ? card.toJSON() : card));

// The usual card has no color; a picture goes on top, the footer under a line.
let card = json(cards.buildPanelFallbackCard({ title: 'Tickets', description: 'Press a button.' }));
assert.equal(card.accent_color ?? null, null, 'no color when none is chosen');
assert.ok(JSON.stringify(card).includes('### Tickets') && JSON.stringify(card).includes('Press a button.'));
card = json(cards.buildPanelFallbackCard({ title: 'T', description: 'D', color: 0xff6b6b, imageUrl: 'https://example.com/banner.png', footer: 'Answers in 24h' }));
assert.equal(card.accent_color, 0xff6b6b);
assert.equal(card.components[0].type, 12, 'the picture is the first thing in the card');
assert.ok(JSON.stringify(card).includes('-# Answers in 24h'), 'the footer is small text');
card = json(cards.buildPanelFallbackCard({ title: 'T', description: 'D', imageUrl: 'http://example.com/no-https.png' }));
assert.notEqual(card.components[0].type, 12, 'only an https picture is used');

// The dropdown says what the server wrote.
const types = [{ key: 'help', label: 'Help', emoji: null, description: 'Questions', button_style: 'primary' }];
let rows = cards.buildPanelRows('select', types, { placeholder: 'Pick one' });
assert.equal(json(rows[0]).components[0].placeholder, 'Pick one');
rows = cards.buildPanelRows('select', types);
assert.match(json(rows[0]).components[0].placeholder, /ticket category/i, 'the usual text without one');
assert.equal(json(cards.buildPanelRows('button', types)[0]).components[0].custom_id, 'tk_open::help');

// The hours: Monday to Friday 09:00 to 21:00 in Bogota (UTC-5).
const week = { hours_enabled: true, hours_timezone: 'America/Bogota', hours_start: '09:00', hours_end: '21:00', hours_days: [1, 2, 3, 4, 5] };
assert.equal(isWithinHours({ hours_enabled: false }), true, 'off means always');
assert.equal(isWithinHours(week, new Date('2026-10-14T15:00:00Z')), true, 'Wednesday 10:00 in Bogota');
assert.equal(isWithinHours(week, new Date('2026-10-14T03:00:00Z')), false, 'Tuesday 22:00 in Bogota');
assert.equal(isWithinHours(week, new Date('2026-10-17T17:00:00Z')), false, 'Saturday noon');
assert.equal(isWithinHours({ ...week, hours_end: '09:00' }, new Date('2026-10-14T15:00:00Z')), true, 'the same start and end is the whole day');
// Through the night: 22:00 to 06:00.
const night = { ...week, hours_start: '22:00', hours_end: '06:00', hours_days: [5] };
assert.equal(isWithinHours(night, new Date('2026-10-17T04:00:00Z')), true, 'Friday 23:00 in Bogota');
assert.equal(isWithinHours(night, new Date('2026-10-17T09:00:00Z')), true, 'Saturday 04:00 still belongs to the Friday');
assert.equal(isWithinHours(night, new Date('2026-10-17T12:00:00Z')), false, 'Saturday 07:00 is over');
assert.equal(isWithinHours({ ...week, hours_timezone: 'Not/AZone' }, new Date('2026-10-14T15:00:00Z')), true, 'a bad timezone is read as UTC, here Wednesday 15:00');
assert.equal(isValidTimezone('America/Bogota'), true);
assert.equal(isValidTimezone('Nope'), false);
assert.equal(toMinutes('09:30'), 570);
assert.equal(toMinutes('24:00'), null);
assert.match(outsideHoursText({ hours_start: '09:00', hours_end: '21:00', hours_timezone: 'America/Bogota' }), /09:00 and 21:00 \(America\/Bogota\)/);
assert.equal(outsideHoursText({ hours_message: 'Back at {start}', hours_start: '08:00' }), 'Back at 08:00');

// Petto's own texts follow the language of the server; what the server wrote stays as it is.
assert.match(json(cards.buildPanelRows('select', types, { lang: 'es' })[0]).components[0].placeholder, /categoría de ticket/);
assert.equal(json(cards.buildPanelRows('select', types, { placeholder: 'Pick one', lang: 'pt-BR' })[0]).components[0].placeholder, 'Pick one');
assert.match(outsideHoursText({ hours_start: '09:00', hours_end: '21:00', hours_timezone: 'America/Bogota' }, 'pt-BR'), /entre 09:00 e 21:00 \(America\/Bogota\)/);
assert.equal(outsideHoursText({ hours_message: 'Back at {start}', hours_start: '08:00' }, 'es'), 'Back at 08:00');

console.log('ticket panel ok');

// The reminder of tickets nobody claimed, and the numbers of the stats.
(() => {
  const { dueForReminder, summarizeStats, durationText } = require('../src/utils/ticketReminders');
  const now = Date.parse('2026-10-14T12:00:00Z');
  const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();
  const open = { status: 'open', channel_id: 'c', claimed_by: null, reminded_at: null, created_at: minutesAgo(31) };
  assert.equal(dueForReminder(open, 30, now), true);
  assert.equal(dueForReminder({ ...open, created_at: minutesAgo(10) }, 30, now), false, 'not yet');
  assert.equal(dueForReminder({ ...open, claimed_by: 'u' }, 30, now), false, 'a claimed ticket needs no reminder');
  assert.equal(dueForReminder({ ...open, reminded_at: minutesAgo(1) }, 30, now), false, 'only once');
  assert.equal(dueForReminder({ ...open, status: 'closed' }, 30, now), false);
  assert.equal(dueForReminder(open, 0, now), false, '0 is off');

  const tickets = [
    { status: 'open', claimed_by: null, created_at: minutesAgo(60), closed_at: null },
    { status: 'open', claimed_by: 'a', created_at: minutesAgo(120), closed_at: null },
    { status: 'closed', claimed_by: 'a', created_at: minutesAgo(60 * 24 * 2), closed_at: minutesAgo(60 * 24 * 2 - 90) },
    { status: 'closed', claimed_by: 'b', created_at: minutesAgo(60 * 24 * 20), closed_at: minutesAgo(60 * 24 * 20 - 30) },
  ];
  const s = summarizeStats(tickets, [{ rating: 5 }, { rating: 4 }, { rating: 9 }], now);
  assert.equal(s.open, 2);
  assert.equal(s.unclaimed, 1);
  assert.equal(s.opened7, 3);
  assert.equal(s.opened30, 4);
  assert.equal(s.closed7, 1);
  assert.equal(s.closed30, 2);
  assert.equal(s.averageMinutesOpen, 60, 'the average of 90 and 30 minutes');
  assert.equal(s.averageRating, 4.5, 'a rating out of 1 to 5 is ignored');
  assert.deepEqual(s.topClaimers[0], { userId: 'a', count: 2 });
  assert.equal(durationText(45), '45 min');
  assert.equal(durationText(200), '3 h 20 min');
  assert.equal(durationText(3000), '2 d 2 h');
  assert.equal(durationText(null), 'no data');
  assert.equal(durationText(null, 'es'), 'sin datos');
  assert.equal(durationText(200, 'pt-BR'), '3 h 20 min');
  console.log('ticket reminders and stats ok');
})();

// Closed tickets: the moment before which their channel can go.
(() => {
  const { deleteCutoff } = require('../src/utils/ticketReminders');
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(deleteCutoff(0, now), null, '0 keeps them');
  assert.equal(deleteCutoff(24, now), '2026-10-13T12:00:00.000Z');
  const reply = require('../src/commands/tickets/quickreply');
  const json = reply.data.toJSON();
  assert.deepEqual(json.options.map((o) => o.name), ['send', 'add', 'remove', 'list']);
  assert.deepEqual(reply.aliases, ['qr', 'macro']);
  console.log('ticket auto delete and quick replies ok');
})();
