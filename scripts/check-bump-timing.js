// The bump reminder goes out at the minute the cooldown ends (an exact timer for each server with a bump waiting), not at the next look of the job that
// reads the table every minute: armed when the bump is seen and when the bot starts, re-checked when it fires (a bump that moved, a channel that was unset,
// a reminder already sent), and never sent twice when the timer and the job meet. The database, Discord and the senders are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const rows = new Map(); // guild -> bump_reminders row
const sent = []; // { guild, at, content }
const upserts = [];
stub('src/db/bumpReminders.js', {
  getConfig: async (guild) => rows.get(guild) ?? null,
  getConfigByChannel: async () => null,
  getDueReminders: async () => [...rows.values()].filter((row) => row.channel_id && row.next_bump_at && Date.parse(row.next_bump_at) <= Date.now()),
  getUpcomingReminders: async () => [...rows.values()].filter((row) => row.channel_id && row.next_bump_at),
  upsertConfig: async (guild, patch) => { upserts.push([guild, patch]); Object.assign(rows.get(guild), patch); },
});
stub('src/utils/senderIdentity.js', { sendAs: async (channel, feature, payload) => { sent.push({ guild: channel.guildId, at: Date.now(), content: payload.content }); return { id: 'm' }; } });
stub('src/utils/embedVariables.js', { resolve: async (text) => text });
stub('src/utils/templatedMessage.js', { templatePayload: async () => null });
stub('src/utils/logger.js', { info() {}, warn() {}, error(...args) { throw new Error(`unexpected error log: ${args.join(' ')}`); }, debug() {} });
stub('src/i18n/index.js', { t: (lang, key) => `[${key}]`, guildLanguage: async () => 'en' });
const { armReminder, armUpcomingReminders, sendReminderIfDue, checkBumpReminders } = require('../src/utils/bumpHandler');

const client = {
  guilds: { fetch: async (id) => ({ id, roles: { everyone: {} }, channels: { fetch: async () => ({ guildId: id, permissionOverwrites: { edit: async () => {} } }) } }) },
  users: { fetch: async () => null },
};
const row = (guild, inMs, extra = {}) => { rows.set(guild, { guild_id: guild, channel_id: 'c', next_bump_at: new Date(Date.now() + inMs).toISOString(), last_bumper_id: null, message: 'Time to bump', reminder_embed_template: null, pingable: false, autolock: false, ...extra }); return rows.get(guild); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  // An exact timer: nothing before the time, the reminder right at it (not at the next look of the job), and the bump marked as done.
  let started = Date.now();
  row('g1', 150);
  armReminder(client, 'g1', Date.parse(rows.get('g1').next_bump_at));
  await sleep(80);
  assert.equal(sent.length, 0, 'not before the time');
  await sleep(200);
  assert.equal(sent.length, 1, 'sent at the time');
  assert.ok(sent[0].at - started >= 140 && sent[0].at - started < 400, 'close to the exact moment');
  assert.deepEqual(upserts.at(-1), ['g1', { next_bump_at: null }], 'the bump is marked as done');
  await sleep(100);
  assert.equal(sent.length, 1, 'once');

  // A bump that moved after the timer was armed (a new bump): the old timer finds the row in the future and sends nothing.
  sent.length = 0;
  row('g2', 80);
  armReminder(client, 'g2', Date.parse(rows.get('g2').next_bump_at));
  rows.get('g2').next_bump_at = new Date(Date.now() + 60_000).toISOString();
  await sleep(250);
  assert.equal(sent.length, 0, 'a stale timer sends nothing');
  // Re-armed for the new time: the timer of before is replaced.
  armReminder(client, 'g2', Date.now() + 100);
  rows.get('g2').next_bump_at = new Date(Date.now() + 100).toISOString();
  await sleep(300);
  assert.equal(sent.length, 1, 'the new time is honoured');

  // The channel was unset, or the reminder was reset (no time): nothing.
  sent.length = 0;
  row('g3', 60, { channel_id: null });
  armReminder(client, 'g3', Date.now() + 60);
  row('g4', 60); armReminder(client, 'g4', Date.now() + 60); rows.get('g4').next_bump_at = null;
  await sleep(250);
  assert.equal(sent.length, 0, 'no channel or no time: nothing');

  // The timer and the job meet: one reminder, and two calls at the same moment are one.
  sent.length = 0;
  row('g5', -1000);
  await Promise.all([sendReminderIfDue(client, 'g5'), sendReminderIfDue(client, 'g5'), checkBumpReminders(client)]);
  assert.equal(sent.length, 1, 'never twice');
  await checkBumpReminders(client);
  assert.equal(sent.length, 1, 'and not again once it is marked as done');

  // The job is the safety net: what was due while the bot was off goes out at once.
  sent.length = 0;
  row('g6', -60_000);
  await checkBumpReminders(client);
  assert.equal(sent.length, 1, 'a reminder that was due is sent by the job');

  // Starting the bot arms a timer for each reminder that is waiting.
  sent.length = 0;
  rows.clear();
  row('a', 120); row('b', 140); row('far', 5 * 60 * 60 * 1000);
  assert.equal(await armUpcomingReminders(client), 3, 'every waiting reminder is looked at');
  await sleep(350);
  assert.deepEqual(sent.map((item) => item.guild).sort(), ['a', 'b'], 'the near ones went out at their time, the far one (more than the cooldown away) is left to the job');

  console.log('Checked the bump reminder: an exact timer, a bump that moved, no channel, never twice, the safety net of the job and the timers armed at start.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
