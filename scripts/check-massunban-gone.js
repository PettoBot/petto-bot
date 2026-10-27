// Checks that `!massunban` stops by itself when the server is gone (or Petto lost access to it) in the middle of the list, instead of
// trying every ban and failing the same way each time, and that it does not fail when it has nowhere left to answer.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

let caseCounter = 0;
const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
const warnings = [];
stub('src/utils/logger.js', { info() {}, debug() {}, error() {}, warn: (...args) => warnings.push(args.join(' ')) });
stub('src/db/hardBans.js', { addHardBan: async () => {}, getHardBan: async () => null, removeHardBan: async () => {}, canLiftHardBan: async () => true, listHardBanIds: async () => new Set() });
stub('src/db/modActions.js', { createCase: async () => ({ case_number: ++caseCounter }), getActiveSanction: async () => null, deactivateCase: async () => {} });
stub('src/utils/caseLog.js', { logSanction: async () => {} });
stub('src/logging/engine.js', { sendLog: async () => {} });
const ban = require('../src/commands/moderation/ban');

const GONE = 'Stopped: Petto lost access';

/** Runs `!massunban` in a server with five bans; `unban(userId, calls)` decides what each unban does. */
async function run({ unban, failFinalReply = false, bansCount = 5 }) {
  const calls = [];
  const replies = [];
  const guilds = new Map([['1', {}]]);
  const ids = bansCount === 5 ? ['a', 'b', 'c', 'd', 'e'] : Array.from({ length: bansCount }, (_, index) => `u${index}`);
  const bans = new Map(ids.map((id) => [id, { user: { id, username: id } }]));
  const guild = {
    id: '1', name: 'Test', iconURL: () => null, bans: { fetch: async () => bans },
    members: { unban: async (userId) => { calls.push(userId); return unban(userId, calls, guilds); } },
  };
  const click = { customId: 'unbanall_confirm', update: async () => {} };
  let edits = 0;
  const interaction = {
    pettoLang: 'en', guild, client: { guilds: { cache: guilds } }, user: { id: 'owner', username: 'owner' },
    member: { permissions: { has: () => true } },
    options: { getString: () => null, getSubcommand: () => 'remove-all' },
    deferReply: async () => {},
    reply: async () => {},
    editReply: async (payload) => {
      edits += 1;
      replies.push(JSON.stringify(payload));
      if (failFinalReply && replies.length >= 2) throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
      return { awaitMessageComponent: async () => click };
    },
  };
  await ban.execute(interaction);
  return { calls, replies };
}

(async () => {
  // The server is gone from the first unban on: one try, not five, and the answer says why.
  let { calls, replies } = await run({ unban: async () => { throw Object.assign(new Error('Unknown Guild'), { code: 10004 }); } });
  assert.deepEqual(calls, ['a'], 'it stops at the first Unknown Guild');
  assert.ok(replies.at(-1).includes(GONE), 'the result says why it stopped');
  assert.ok(warnings.some((line) => line.includes('stopped in 1')), 'one warning, not one per ban');
  assert.equal(warnings.filter((line) => line.includes('failed to unban')).length, 0);

  // Missing permission and missing access stop it too.
  for (const code of [50001, 50013]) {
    ({ calls } = await run({ unban: async () => { throw Object.assign(new Error('x'), { code }); } }));
    assert.equal(calls.length, 1, `code ${code} stops the list`);
  }

  // Petto leaves the server in the middle: the next one is not even tried.
  ({ calls } = await run({ unban: async (userId, _calls, guilds) => { guilds.delete('1'); } }));
  assert.deepEqual(calls, ['a'], 'it checks that the server is still there before each unban');

  // Another kind of failure (one user) does not stop the others.
  ({ calls, replies } = await run({ unban: async (userId) => { if (userId === 'b') throw Object.assign(new Error('Unknown Ban'), { code: 10026 }); } }));
  assert.deepEqual(calls, ['a', 'b', 'c', 'd', 'e'], 'a single failed unban goes on with the list');
  assert.ok(!replies.at(-1).includes(GONE));

  // The channel is gone when the result is shown: the command ends without an error.
  await run({ unban: async () => { throw Object.assign(new Error('Unknown Guild'), { code: 10004 }); }, failFinalReply: true });
  assert.ok(warnings.some((line) => line.includes('could not show the result')));
  // Thousands of bans: the result lists the first and the last case and how many, not every number (a list of 4000 characters broke the card and the command ended with an error).
  caseCounter = 100;
  ({ calls, replies } = await run({ unban: async () => {}, bansCount: 3000 }));
  assert.equal(calls.length, 3000);
  const result = replies.at(-1);
  assert.ok(result.includes('Cases #101 to #3100 (3000 in all)'), 'the result says the first and the last case and how many');
  assert.ok(!result.includes('#102,'), 'and not the whole list');
  const { addBlocks } = require('../src/utils/cardBlocks');
  const { ContainerBuilder } = require('discord.js');
  assert.doesNotThrow(() => addBlocks(new ContainerBuilder(), 'x'.repeat(9000)), 'a text longer than 4000 characters is cut, it does not make the card fail');
  assert.equal(JSON.stringify(addBlocks(new ContainerBuilder(), 'y'.repeat(9000)).toJSON()).includes('y'.repeat(4001)), false);
  console.log('check-massunban-gone: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
