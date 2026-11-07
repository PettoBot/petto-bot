// The color of a confession: pastel yellow by default, and a server that still has the old green default saved gets the new default.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
let stored = null;
stub('src/db/database.js', { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored, error: null }) }) }) }) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
const db = require('../src/db/confessions');

(async () => {
  assert.equal(db.DEFAULTS.color, db.DEFAULT_COLOR);
  assert.equal(db.DEFAULT_COLOR, 0xffee99, 'the new default is a soft yellow');
  stored = null;
  assert.equal((await db.getConfig('1')).color, 0xffee99, 'a server with no settings');
  stored = { guild_id: '1', color: 0xa5ea7a };
  assert.equal((await db.getConfig('1')).color, 0xffee99, 'the old green default is shown as the new default');
  stored = { guild_id: '1', color: 0x123456 };
  assert.equal((await db.getConfig('1')).color, 0x123456, 'a color the server chose is kept');
  console.log('Checked the color of the confessions: the new default, the old default moved and a chosen color kept.');
})().catch((error) => { console.error(error); process.exit(1); });
