// The look of a ticket panel (color, picture, footer, dropdown text) and the hours of the staff.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
const assert = require('node:assert/strict');
const cards = require('../src/utils/ticketCards');
const { isWithinHours, outsideHoursText, isValidTimezone, toMinutes } = require('../src/utils/ticketHours');

const json = (card) => JSON.parse(JSON.stringify(card.toJSON ? card.toJSON() : card));

// The usual card is green; a picture goes on top, the footer under a line.
let card = json(cards.buildPanelFallbackCard({ title: 'Tickets', description: 'Press a button.' }));
assert.equal(card.accent_color, 0xa5ea7a, 'the green of Petto when no color is chosen');
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

console.log('ticket panel ok');
