// i18n-ignore-file: check script.
// A server reported as removed when Petto is still in it (after a restart): no "Petto left a server: undefined" in the log and no departure written down.
const assert = require('node:assert/strict');
const Module = require('node:module');
const logger = require('../src/utils/logger');
logger.localWarn = () => {};
logger.info = () => {};

const marks = [];
const sent = [];
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (/db[\\/]guildDepartures$/.test(request)) return { mark: async (id) => { marks.push(id); }, clear: async () => {} };
  if (/db[\\/]guildBlacklist$/.test(request)) return { isBlacklisted: () => false };
  if (/utils[\\/]discordOps$/.test(request)) return { sendGuildLifecycleLog: async (_client, options) => { sent.push(options); } };
  return originalLoad.call(this, request, parent, isMain);
};
const event = require('../src/events/guildDelete');
const { isBare, presence } = require('../src/utils/guildGone');

(async () => {
  assert.equal(isBare({ id: '1' }), true, 'a bare object has no name');
  assert.equal(isBare({ id: '1', name: 'Home', available: false }), true, 'an unavailable server is bare');
  assert.equal(isBare({ id: '1', name: 'Home' }), false, 'a loaded server has a name');

  const run = async (guild) => { marks.length = 0; sent.length = 0; await event.execute(guild); return { marks: [...marks], sent: [...sent] }; };
  const withFetch = (impl) => ({ guilds: { fetch: impl } });

  // Unavailable: nothing is told, nothing is written down.
  let result = await run({ id: '10', available: false, client: withFetch(async () => { throw new Error('must not ask'); }) });
  assert.deepEqual(result, { marks: [], sent: [] }, 'an unavailable server is not a departure');

  // A bare object while Petto is still in the server (Discord gives it back).
  result = await run({ id: '11', client: withFetch(async () => ({ id: '11', name: 'Still here' })) });
  assert.deepEqual(result, { marks: [], sent: [] }, 'Petto is still in: no log and no departure');

  // A bare object and the question fails for another reason: nothing is told.
  result = await run({ id: '12', client: withFetch(async () => { throw Object.assign(new Error('timeout'), { code: 'UND_ERR' }); }) });
  assert.deepEqual(result, { marks: [], sent: [] }, 'unknown: nothing is told and nothing is written down');

  // A bare object and Discord says Unknown Guild or Missing Access: Petto is out.
  for (const error of [Object.assign(new Error('Unknown Guild'), { code: 10004 }), Object.assign(new Error('Missing Access'), { code: 50001 }), Object.assign(new Error('x'), { status: 403 })]) {
    result = await run({ id: '13', client: withFetch(async () => { throw error; }) });
    assert.equal(result.marks.length, 1, 'really out: the departure is written down');
    assert.equal(result.sent.length, 1, 'really out: the log is sent');
  }

  // A loaded server that is removed: as before, no question to Discord.
  result = await run({ id: '14', name: 'Home', ownerId: '5', client: withFetch(async () => { throw new Error('must not ask'); }) });
  assert.equal(result.marks.length, 1);
  assert.equal(result.sent.length, 1);

  assert.equal(await presence({}, '1', { fetch: async () => null }), 'out');
  console.log('check-guild-delete-partial: ok');
})().catch((error) => { console.error(error); process.exit(1); });
