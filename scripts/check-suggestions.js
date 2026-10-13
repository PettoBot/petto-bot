// Suggestions: the pure helpers, the vote row and the command definitions.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', {});
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const s = require('../src/utils/suggestions');
const cmd = require('../src/commands/config/suggestion');
const suggest = require('../src/commands/utility/suggest');

assert.strictEqual(s.BUTTON_PREFIX, 'sug');
for (const k of ['pending', 'approved', 'denied', 'considering', 'implemented']) assert.ok(s.STATUSES[k], `status ${k}`);
const id = s.makeId();
assert.ok(/^[a-z0-9]{5}-[a-z0-9]{5}$/.test(id), `id ${id}`);
assert.notStrictEqual(id, s.makeId());

const json = cmd.data.toJSON();
const subs = json.options.map((o) => o.name);
for (const n of ['setup', 'enable', 'disable', 'config', 'set', 'approve', 'deny', 'consider', 'implement', 'delete', 'block', 'unblock', 'panel']) assert.ok(subs.includes(n), `sub ${n}`);
assert.strictEqual(suggest.data.toJSON().name, 'suggest');
// The usual look has no color; the status colors are only used when the server turns them on.
const off = s.defaultDesign({ status_colors: false, color_pending: 1, anonymous: false }, 'pending').v2.components[0];
assert.equal(off.accent_color, null);
const on = s.defaultDesign({ status_colors: true, color_pending: 1, anonymous: false }, 'pending').v2.components[0];
assert.equal(on.accent_color, 1);
console.log('suggestions ok');
