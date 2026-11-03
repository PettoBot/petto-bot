// The direct message of a join (src/events/guildMemberAddDmJoin.js): it goes a few seconds after the join (Discord needs a moment to count a new member as someone who
// shares a server with Petto), it is tried again a few times when Discord still refuses it with 50278, it is not sent to someone who already left, and a member whose DMs
// are closed is left alone. Discord, the database and the sender are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
process.env.JOIN_DM_DELAY_MS = '60';
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

let config = { dm_join_message: 'Hello {user}' };
const errors = [];
const attempts = []; // when each send was tried
let outcomes = []; // what each send answers: undefined (sent) or { failed: code }
stub('src/db/memberEvents.js', { getConfig: async () => config });
stub('src/utils/logger.js', { info() {}, warn() {}, error(...args) { errors.push(args); }, debug() {} });
stub('src/utils/inviteContext.js', { inviteInfoFor: async (member, { recorded = false } = {}) => ({ recorded }) });
stub('src/utils/memberEventMessage.js', {
  NO_MUTUAL_SERVER: 50278,
  DMS_CLOSED: 50007,
  sendMemberEvent: async ({ ctx }) => { attempts.push({ at: Date.now(), recorded: ctx.invite.recorded }); return outcomes.shift(); },
});
const event = require('../src/events/guildMemberAddDmJoin');
const { NO_MUTUAL_SERVER, DMS_CLOSED } = require('../src/utils/memberEventMessage');
event.RETRY_MS.splice(0, event.RETRY_MS.length, 40, 40, 40); // the retries come fast here (30 s, 2 min and 10 min in production)

let present = true;
const makeMember = ({ dmOpen = true } = {}) => {
  const guild = { id: '900', members: { fetch: async () => { if (!present) throw new Error('Unknown Member'); return member; } } };
  const member = { id: '800', guild, createDM: async () => (dmOpen ? { dm: true } : Promise.reject(new Error('Cannot send messages to this user'))) };
  return member;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  assert.equal(event.DELAY_MS, 60, 'the first wait is JOIN_DM_DELAY_MS');

  // It waits before the first try.
  let started = Date.now();
  await event.execute(makeMember());
  assert.equal(attempts.length, 1);
  assert.ok(attempts[0].at - started >= 50, 'the DM goes after the wait, not in the same instant as the join');
  assert.equal(attempts[0].recorded, false, 'a live join reads the invite the usual way');

  // Discord refuses it twice, then it goes: three tries in all, later ones read the invite recorded at the join.
  attempts.length = 0; outcomes = [{ failed: NO_MUTUAL_SERVER }, { failed: NO_MUTUAL_SERVER }, undefined];
  await event.execute(makeMember());
  await sleep(300);
  assert.equal(attempts.length, 3, 'tried again while Discord says there is no server in common yet');
  assert.deepEqual(attempts.map((a) => a.recorded), [false, true, true]);
  assert.deepEqual(errors, [], 'nothing is logged as an error for it');

  // It never goes: one try and three retries, then it gives up for good.
  attempts.length = 0; outcomes = Array.from({ length: 10 }, () => ({ failed: NO_MUTUAL_SERVER }));
  await event.execute(makeMember());
  await sleep(450);
  assert.equal(attempts.length, 4, 'one try and three retries, no more');

  // DMs closed (the refusal of the send, or the chat that cannot be opened): no retry.
  attempts.length = 0; outcomes = [{ failed: DMS_CLOSED }];
  await event.execute(makeMember());
  await sleep(200);
  assert.equal(attempts.length, 1, 'closed DMs are not tried again');
  attempts.length = 0; outcomes = [];
  await event.execute(makeMember({ dmOpen: false }));
  await sleep(100);
  assert.equal(attempts.length, 0, 'a chat that cannot be opened is left alone');

  // The member leaves during the wait, or between two tries.
  attempts.length = 0; outcomes = [];
  present = false;
  await event.execute(makeMember());
  assert.equal(attempts.length, 0, 'nobody to write to if they left during the wait');
  present = true;
  outcomes = [{ failed: NO_MUTUAL_SERVER }, undefined];
  await event.execute(makeMember());
  present = false;
  await sleep(200);
  assert.equal(attempts.length, 1, 'a member who left before the retry is not written to');
  present = true;

  // The settings are read again at each retry: a server that turned the message off stops it.
  attempts.length = 0; outcomes = [{ failed: NO_MUTUAL_SERVER }, undefined];
  await event.execute(makeMember());
  config = {};
  await sleep(200);
  assert.equal(attempts.length, 1, 'the message turned off is not sent by a retry');
  config = { dm_join_message: 'Hello' };

  // No message configured: nothing, not even a wait.
  attempts.length = 0; outcomes = [];
  config = {};
  started = Date.now();
  await event.execute(makeMember());
  assert.equal(attempts.length, 0);
  assert.ok(Date.now() - started < 40, 'no wait when there is nothing to send');
  config = { dm_join_embed_template: 'welcome-dm' };
  await event.execute(makeMember());
  assert.equal(attempts.length, 1, 'a saved design is a message too');
  config = { dm_join_message: 'Hello' };

  assert.deepEqual(errors, [], 'no unexpected error was logged');
  console.log('Checked the DM of a join: the wait, the retries when Discord says there is no server in common, closed DMs, a member who left and the settings turned off.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
