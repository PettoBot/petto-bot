// Checks the total of members that Petto reports: it adds the real counts, and a server whose count is missing for a moment
// keeps its last good count instead of taking its members off the total. Nothing is added that is not a real count.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { discord: {}, channels: {} });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
let ops;
try { ops = require('../src/utils/discordOps'); } catch (error) { console.error(error); process.exit(1); }
const { memberCount } = ops;

const guilds = new Map([['a', { id: 'a', memberCount: 100 }], ['b', { id: 'b', memberCount: 250 }]]);
const client = { guilds: { cache: guilds } };
assert.equal(memberCount(client), 350, 'the real counts are added');
guilds.get('b').memberCount = 0;
assert.equal(memberCount(client), 350, 'a server whose count is missing keeps its last good count');
guilds.get('b').memberCount = undefined;
assert.equal(memberCount(client), 350);
guilds.get('b').memberCount = 300;
assert.equal(memberCount(client), 400, 'a new real count replaces the old one');
guilds.set('c', { id: 'c', memberCount: 0 });
assert.equal(memberCount(client), 400, 'a server that was never counted adds nothing');
guilds.delete('a');
assert.equal(memberCount(client), 300, 'a server the bot left stops adding members');
guilds.get('c').memberCount = 50;
assert.equal(memberCount(client), 350);
console.log('member total ok');
