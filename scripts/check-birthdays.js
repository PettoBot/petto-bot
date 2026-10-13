// Checks the birthdays: what counts as a date, 29 February, ages, the offsets, and the daily job (who is announced, the role, a day only once).
// The database and Discord are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const rows = [
  { guild_id: 'g1', user_id: 'u1', month: 10, day: 13, year: 2007 },
  { guild_id: 'g1', user_id: 'u2', month: 2, day: 29, year: 2004 },
  { guild_id: 'g1', user_id: 'bot', month: 10, day: 13, year: null },
];
const state = { claimed: new Set(), roles: new Map(), sent: [], removed: [] };
const config = { guild_id: 'g1', enabled: true, channel_id: 'c1', role_id: 'r1', message: 'Happy birthday {user}! You turn {age}.', embed_template: null, hour: 9, utc_offset_minutes: -300, last_announced: null };
stub('src/db/birthdays.js', {
  onDay: async (guildId, month, day) => rows.filter((row) => row.guild_id === guildId && row.month === month && row.day === day),
  listEnabledConfigs: async () => [{ ...config, last_announced: state.claimed.has('g1') ? [...state.claimed][0] : null }],
  claimDay: async (guildId, date) => { if (state.claimed.has(date)) return false; state.claimed.add(date); return true; },
  rememberRole: async (guildId, userId, roleId, removeAt) => { state.roles.set(userId, { roleId, removeAt }); },
  listDueRoles: async () => [...state.roles.entries()].filter(([, v]) => v.removeAt.getTime() <= Date.now()).map(([user_id, v]) => ({ guild_id: 'g1', user_id, role_id: v.roleId })),
  forgetRole: async (guildId, userId) => { state.roles.delete(userId); },
});
stub('src/utils/memberEventMessage.js', { sendMemberEvent: async (options) => { state.sent.push({ kind: options.kind, text: options.messageText, user: options.ctx.member.id, asCard: options.asCard }); } });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const birthdays = require('../src/utils/birthdays');
const { processBirthdays } = require('../src/jobs/birthdayJob');

(async () => {
  // Dates.
  assert.deepEqual(birthdays.parseBirthday({ day: 25, month: 12 }), { month: 12, day: 25, year: null });
  assert.ok(birthdays.parseBirthday({ day: 30, month: 2 }).error, 'there is no 30 February');
  assert.ok(birthdays.parseBirthday({ day: 29, month: 2, year: 2001 }).error, '2001 had no 29 February');
  assert.equal(birthdays.parseBirthday({ day: 29, month: 2, year: 2004 }).year, 2004);
  assert.ok(birthdays.parseBirthday({ day: 1, month: 1, year: 2100 }).error, 'a year in the future is refused');
  assert.ok(birthdays.parseBirthday({ day: 1, month: 13 }).error);
  // 29 February is celebrated on the 28th in years with no 29th.
  assert.equal(birthdays.celebratesOn({ month: 2, day: 29 }, { year: 2027, month: 2, day: 28 }), true);
  assert.equal(birthdays.celebratesOn({ month: 2, day: 29 }, { year: 2028, month: 2, day: 28 }), false);
  assert.equal(birthdays.celebratesOn({ month: 2, day: 29 }, { year: 2028, month: 2, day: 29 }), true);
  // Days left and ages.
  const local = birthdays.localDate(new Date('2026-10-13T14:00:00Z'), -300);
  assert.deepEqual([local.iso, local.hour], ['2026-10-13', 9], 'the date follows the time zone of the server');
  assert.equal(birthdays.daysUntil({ month: 10, day: 13 }, local), 0);
  assert.equal(birthdays.daysUntil({ month: 10, day: 12 }, local), 364);
  assert.equal(birthdays.nextAge({ month: 2, day: 1, year: 2007 }, local), 20, 'the next one is the one after this year');
  assert.equal(birthdays.nextAge({ month: 12, day: 1, year: 2007 }, local), 19);
  assert.equal(birthdays.nextAge({ month: 12, day: 1, year: null }, local), null);
  // Offsets.
  assert.deepEqual(['UTC-5', '-5', '+5:30', 'GMT+0530'].map(birthdays.parseOffset), [-300, -300, 330, 330]);
  assert.equal(birthdays.parseOffset('banana'), null);
  assert.equal(birthdays.parseOffset('+20'), null);
  assert.equal(birthdays.formatOffset(-300), 'UTC-5');

  // The job: before the hour nothing happens; at the hour the people of the day are announced and given the role; the same day only once.
  const added = [];
  const member = (id, bot = false) => ({ id, user: { id, bot }, roles: { add: async (role) => { added.push([id, role.id]); }, remove: async (roleId) => { state.removed.push([id, roleId]); } } });
  const client = {
    guilds: { cache: new Map([['g1', {
      id: 'g1',
      channels: { fetch: async () => ({ isTextBased: () => true }) },
      roles: { cache: new Map([['r1', { id: 'r1', editable: true }]]) },
      members: { fetch: async (id) => (id === 'gone' ? Promise.reject(new Error('unknown member')) : member(id, id === 'bot')) },
    }]]) },
  };
  await processBirthdays(client, new Date('2026-10-13T13:00:00Z')); // 08:00 local
  assert.equal(state.sent.length, 0, 'before the hour of the server nothing is sent');
  await processBirthdays(client, new Date('2026-10-13T14:10:00Z')); // 09:10 local
  assert.deepEqual(state.sent.map((entry) => [entry.kind, entry.user, entry.text]), [['birthday', 'u1', 'Happy birthday {user}! You turn 19.']], 'one message, the bot is left out and {age} is filled');
  assert.equal(state.sent[0].asCard, false, 'a message the server wrote stays as it wrote it');
  assert.deepEqual(added, [['u1', 'r1']], 'the role is given');
  assert.ok(state.roles.get('u1').removeAt.getTime() > Date.now() + 23 * 3_600_000, 'and taken back about a day later');
  await processBirthdays(client, new Date('2026-10-13T20:00:00Z'));
  assert.equal(state.sent.length, 1, 'the same day is announced once');
  // The role goes back when its time comes.
  state.roles.get('u1').removeAt = new Date(Date.now() - 1000);
  await processBirthdays(client, new Date('2026-10-13T21:00:00Z'));
  assert.deepEqual(state.removed, [['u1', 'r1']]);
  assert.equal(state.roles.size, 0);
  console.log('Checked the birthdays: dates, 29 February, ages, time zones and the daily job.');
})().catch((error) => { console.error(error); process.exit(1); });
