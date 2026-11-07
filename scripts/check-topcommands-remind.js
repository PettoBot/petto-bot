// The reminder cards (no database numbers shown, the list numbered 1, 2, 3 for each member) and /topcommands (the board, its pages, the count).
const assert = require('node:assert/strict');
const path = require('node:path');

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel));
const stub = (rel, exports) => { require.cache[resolve(rel)] = { id: resolve(rel), filename: resolve(rel), loaded: true, exports }; };

stub('src/config.js', { verifyTokenSecret: 'a-secret-for-the-check-of-the-cards' });
stub('src/utils/logger.js', { warn() {}, info() {}, error() {}, debug() {} });
stub('src/utils/hiddenCommands.js', { isHiddenEverywhere: (c) => Boolean(c.hiddenEverywhere), isTeamOnly: (c) => Boolean(c.teamOnly) });

const queries = [];
let failWrites = false;
stub('src/db/postgres.js', { getPrimaryPool: () => ({ query: async (sql, params) => {
  queries.push([sql, params]);
  if (/^select/i.test(sql)) return { rows: [{ command: 'afk', uses: '5' }] };
  if (failWrites) throw new Error('the database is down');
  return { rows: [] };
} }) });

stub('src/db/guilds.js', { ensureGuild: async () => null });
const reminders = [];
stub('src/db/reminders.js', {
  createReminder: async (row) => { reminders.push({ id: 90210 + reminders.length, ...row, remind_at: row.remindAt.toISOString() }); return reminders[reminders.length - 1]; },
  listActive: async () => reminders.slice(),
  cancelReminder: async (_g, _u, id) => { const i = reminders.findIndex((r) => r.id === id); if (i < 0) return false; reminders.splice(i, 1); return true; },
});

const { reminderSetCard, reminderListCard } = require('../src/commands/utility/remind.js');
const commandUsage = require('../src/utils/commandUsage.js');
const usageDb = require('../src/db/commandUsage.js');
const topcommands = require('../src/commands/utility/topcommands.js');

const text = (card) => JSON.stringify(card.toJSON());

(async () => {
  // Reminders: the confirmation has the message, the place and the moment, and no number.
  const at = new Date(Date.now() + 9 * 60_000);
  for (const lang of ['en', 'es', 'pt-BR']) {
    const set = text(reminderSetCard({ lang, channelId: '123456789012345678', message: 'drink water', remindAt: at }));
    assert.ok(set.includes('drink water') && set.includes('<#123456789012345678>') && set.includes(`<t:${Math.floor(at.getTime() / 1000)}:R>`), `${lang}: the reminder card has the message, the channel and the moment`);
    assert.ok(!/#\d{3,}/.test(set.replace(/<#\d+>/g, '')), `${lang}: no database number is shown`);
    assert.ok(!set.includes('utility.remind'), `${lang}: every text is translated`);
  }
  const rows = [{ id: 90210, remind_at: at, message: 'first' }, { id: 90555, remind_at: at, message: 'x'.repeat(500) }];
  const listCard = reminderListCard({ lang: 'en', rows }).toJSON();
  const shown = JSON.stringify(listCard.components.filter((c) => c.type === 10));
  assert.ok(!/\*\*\d+\.\*\*/.test(shown), 'the list has no numbers at all');
  assert.ok(!shown.includes('90210') && !shown.includes('90555'), 'the database numbers never show');
  assert.ok(shown.includes('first') && shown.length < 4000 + 600, 'the messages show and a long one is cut');
  const menu = listCard.components.find((c) => c.type === 1)?.components?.[0];
  assert.ok(menu && menu.type === 3 && menu.custom_id === 'remind_cancel', 'a menu cancels one of them');
  assert.deepEqual(menu.options.map((option) => option.value), ['90210', '90555'], 'the menu is made of the member\'s own reminders');
  assert.ok(menu.options.every((option) => option.label.length <= 100 && option.description.length <= 100), 'the options fit what Discord allows');
  const none = JSON.stringify(reminderListCard({ lang: 'en', rows: [] }).toJSON());
  assert.ok(!none.includes('remind_cancel'), 'no menu when there is nothing to cancel');

  // The board: a command starts between one and two million, the same every time, and the runs counted are added.
  for (const name of ['afk', 'snipe', 'remind', 'a-new-command']) {
    const base = commandUsage.baselineOf(name, {});
    assert.ok(base >= commandUsage.BASELINE_MIN && base <= commandUsage.BASELINE_MIN + commandUsage.BASELINE_SPAN, `${name} starts between one and two million`);
    assert.equal(base, commandUsage.baselineOf(name, {}), `${name} starts from the same number every time`);
  }
  assert.equal(commandUsage.baselineOf('afk', { afk: 1234567 }), 1234567, 'the team\'s own count wins');
  const spread = new Set(['afk', 'snipe', 'role', 'purge', 'avatar', 'play', 'image', 'ban', 'timezone'].map((n) => commandUsage.baselineOf(n, {})));
  assert.ok(spread.size >= 8, 'the starting numbers differ');

  const fake = (name, extra = {}) => ({ data: { name, toJSON: () => ({ type: 1 }) }, ...extra });
  const client = { commands: new Map([['afk', fake('afk')], ['snipe', fake('snipe')], ['perf', fake('perf', { hiddenFromHelp: true })], ['slots', fake('slots', { teamOnly: true })], ['music', fake('music', { hiddenEverywhere: true })]]) };
  const board = await commandUsage.buildBoard(client, { counted: new Map([['afk', 7]]), overrides: {} });
  assert.deepEqual(board.map((e) => e.name).sort(), ['afk', 'snipe'], 'private tools of the team and hidden commands are not listed');
  assert.equal(board.find((e) => e.name === 'afk').uses, commandUsage.baselineOf('afk', {}) + 7, 'what was counted is added to the start');
  assert.ok(board[0].uses >= board[1].uses, 'highest first');

  // Pages: ten lines, buttons only when there is more than one page, and the numbers with separators.
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `cmd${i}`, uses: 1_900_000 - i }));
  const page = topcommands.buildPage({ board: many, page: 1, lang: 'en' });
  const json = text(page.card);
  assert.equal(page.totalPages, 3);
  assert.ok(json.includes('1,899,999') && json.includes('Page 1/3 (25 entries)') && json.includes('topcmds_next'), 'the first page shows the numbers, the page and the buttons');
  assert.ok(!text(topcommands.buildPage({ board: many.slice(0, 5), page: 1, lang: 'en' }).card).includes('topcmds_next'), 'one page has no buttons');

  // Counting: runs are written together, and a failed write is kept for the next one.
  usageDb.recordCommandUse('afk'); usageDb.recordCommandUse('afk'); usageDb.recordCommandUse('snipe');
  failWrites = true;
  await usageDb.flushCommandUsage();
  failWrites = false;
  queries.length = 0;
  await usageDb.flushCommandUsage();
  const write = queries.find(([sql]) => /^insert/i.test(sql));
  assert.ok(write, 'the counts that failed are written the next time');
  assert.deepEqual(write[1][0].slice().sort(), ['afk', 'snipe']);
  assert.equal(write[1][1][write[1][0].indexOf('afk')], 2, 'nothing is lost or counted twice');
  console.log('Reminder cards and /topcommands checks passed.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
