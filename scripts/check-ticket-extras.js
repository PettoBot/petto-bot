// Checks the pieces of the ticket extras that need no server: channel names, the welcome text and the priorities.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database', { from: () => ({}) });

const { formatTicketChannelName } = require('../src/utils/ticketName');
const { renderWelcomeText, buildCloseRequestRow } = require('../src/utils/ticketCards');
const db = require('../src/db/tickets');

assert.equal(formatTicketChannelName('{category}-{username}-{number}', { number: 7, username: 'Liam', userId: '1', category: 'Report a Player' }), 'report-a-player-liam-0007');
assert.equal(formatTicketChannelName('t-{userid}', { number: 1, username: 'x', userId: '123', category: 'c' }), 't-123');
assert.equal(formatTicketChannelName('', { number: 3, username: 'x' }), 'ticket-0003');

const opener = Object.assign(new String('<@5>'), { username: 'Liam' });
assert.equal(
  renderWelcomeText('Hi {user} ({username})! {category} ticket {number} in {server}.', { opener, categoryLabel: 'Support', guildName: 'Petto', ticketNumber: 12 }),
  'Hi <@5> (Liam)! Support ticket 0012 in Petto.',
);

assert.deepEqual(db.PRIORITIES, ['low', 'normal', 'high', 'urgent']);
const row = buildCloseRequestRow(9).toJSON();
assert.deepEqual(row.components.map((c) => c.custom_id), ['tk_closeyes::9', 'tk_closeno::9']);

assert.rejects(() => db.setPriority(1, 'whenever'), /Priority must be/).then(() => {
  console.log('Checked the ticket extras: names, welcome text, priorities and the close request buttons.');
});
