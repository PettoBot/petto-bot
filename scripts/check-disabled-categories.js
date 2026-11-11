// Checks that a command turned off for a category stops it in every channel inside it (and in its threads), that the channel and the server keep working as
// they did, and that a rule of another category or channel does not reach it.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const postgres = require('../src/db/postgres');
const GUILD = '111111111111111111';
const CATEGORY = '222222222222222221';
const OTHER_CATEGORY = '222222222222222222';
const CHANNEL = '333333333333333331';
const LOOSE = '333333333333333332';
let rows = [];
postgres.getPrimaryPool = () => ({ query: async () => ({ rows }) });
const disabledDb = require('../src/db/disabledCommands');
const rules = require('../src/utils/commandRules');

(async () => {
  rows = [
    { id: 1, guild_id: GUILD, command: 'rank', channel_id: CATEGORY },
    { id: 2, guild_id: GUILD, command: 'kiss', channel_id: CHANNEL },
    { id: 3, guild_id: GUILD, command: 'ping', channel_id: null },
  ];
  disabledDb.invalidateCache(GUILD);
  const found = async (command, channel, parents) => (await disabledDb.findCached(GUILD, command, channel, parents))?.id ?? null;
  assert.equal(await found('rank', CHANNEL, [CATEGORY]), 1, 'a command turned off for a category stops in a channel inside it');
  assert.equal(await found('rank', CATEGORY, []), 1, 'and in the category itself');
  assert.equal(await found('rank', CHANNEL, [OTHER_CATEGORY]), null, 'not in a channel of another category');
  assert.equal(await found('rank', LOOSE, []), null, 'not in a channel with no category');
  assert.equal(await found('rank', CHANNEL, undefined), null, 'with no category given nothing changes');
  assert.equal(await found('kiss', CHANNEL, [CATEGORY]), 2, 'a rule of the channel still works');
  assert.equal(await found('kiss', LOOSE, [CATEGORY]), null, 'and only there');
  assert.equal(await found('ping', LOOSE, []), 3, 'a rule of the whole server still works');
  rows = [{ id: 4, guild_id: GUILD, command: 'rank', channel_id: CATEGORY }, { id: 5, guild_id: GUILD, command: 'rank', channel_id: null }];
  disabledDb.invalidateCache(GUILD);
  assert.equal(await found('rank', CHANNEL, [CATEGORY]), 5, 'the whole server comes first, then the channel, then the category');

  // The categories of a channel: its own, and for a thread the one of the channel it is in.
  assert.deepEqual(rules.categoriesOf({ parentId: CATEGORY }), [CATEGORY]);
  assert.deepEqual(rules.categoriesOf({ parentId: CHANNEL, parent: { parentId: CATEGORY } }), [CHANNEL, CATEGORY], 'a thread: its channel and the category of that channel');
  assert.deepEqual(rules.categoriesOf({}), []);
  assert.deepEqual(rules.categoriesOf(null), []);

  // disabledFor hands the categories to the store.
  let seen = null;
  const store = { findCached: async (...args) => { seen = args; return { id: 9 }; } };
  assert.equal((await rules.disabledFor(GUILD, ['rank'], CHANNEL, store, [CATEGORY])).name, 'rank');
  assert.deepEqual(seen, [GUILD, 'rank', CHANNEL, [CATEGORY]]);
  console.log('Disabled command checks passed (a category stops the command in its channels and threads).');
})().catch((error) => { console.error(error); process.exit(1); });
