// Who may lift a hardban: the server owner and the antinuke admins, nobody else.
const assert = require('node:assert/strict');
const path = require('node:path');

const antinukePath = path.resolve(__dirname, '../src/db/antinuke.js');
const postgresPath = path.resolve(__dirname, '../src/db/postgres.js');
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
let whitelist = ['admin1'];
stub(antinukePath, { getConfig: async () => ({ whitelist_ids: whitelist }) });
stub(postgresPath, { getPrimaryPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }) });

const { canLiftHardBan } = require('../src/db/hardBans');

(async () => {
  const guild = { id: 'g1', ownerId: 'owner' };
  assert.equal(await canLiftHardBan(guild, 'owner'), true, 'the owner may lift it');
  assert.equal(await canLiftHardBan(guild, 'admin1'), true, 'an antinuke admin may lift it');
  assert.equal(await canLiftHardBan(guild, 'mod'), false, 'a moderator may not');
  whitelist = [];
  assert.equal(await canLiftHardBan(guild, 'admin1'), false, 'an admin removed from the list may not');
  console.log('hardban checks passed');
})();
