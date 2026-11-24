// The top of the richest people: the query asks for the right order and limit, and the limit is kept between 1 and 25.
const assert = require('node:assert/strict');
const path = require('node:path');
const calls = [];
const postgresPath = require.resolve(path.join('..', 'src', 'db', 'postgres'));
require.cache[postgresPath] = { id: postgresPath, filename: postgresPath, loaded: true, exports: { getPrimaryPool: () => ({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ user_id: '2', balance: '900' }, { user_id: '1', balance: '5' }] }; } }) } };
const db = require('../src/db/ceramos');
(async () => {
  const top = await db.topBalances(10);
  assert.deepEqual(top, [{ userId: '2', balance: 900 }, { userId: '1', balance: 5 }]);
  assert.match(calls[0].sql, /order by balance desc/);
  assert.match(calls[0].sql, /balance > 0/);
  await db.topBalances(1000); await db.topBalances(0);
  assert.equal(calls[1].params[0], 25);
  assert.equal(calls[2].params[0], 1);
  console.log('ceramos top: ok');
})().catch((error) => { console.error(error); process.exit(1); });
