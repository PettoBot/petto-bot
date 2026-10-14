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

(async () => {
const json = cmd.data.toJSON();
const subs = json.options.map((o) => o.name);
for (const n of ['votes', 'setup', 'enable', 'disable', 'config', 'set', 'approve', 'deny', 'consider', 'implement', 'delete', 'block', 'unblock', 'panel']) assert.ok(subs.includes(n), `sub ${n}`);
assert.strictEqual(suggest.data.toJSON().name, 'suggest');
// The usual look has no color; the status colors are only used when the server turns them on.
const off = s.defaultDesign({ status_colors: false, color_pending: 1, anonymous: false }, 'pending').v2.components[0];
assert.equal(off.accent_color, null);
const on = s.defaultDesign({ status_colors: true, color_pending: 1, anonymous: false }, 'pending').v2.components[0];
assert.equal(on.accent_color, 1);

// The picture of a suggestion is a file of its own message, so it still shows when the member's message is deleted.
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
assert.equal(s.pictureName(png), 'suggestion.png');
assert.equal(s.pictureName(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'suggestion.jpg');
assert.equal(s.pictureName(Buffer.from('GIF89a......')), 'suggestion.gif');
assert.equal(s.pictureName(Buffer.from('RIFF....WEBPVP8 ')), 'suggestion.webp');
assert.equal(s.pictureName(Buffer.from('<html>not a picture</html>')), null);
const { build } = require('../src/utils/embedBuilder');
const empty = () => ({ cache: new Map() });
const guild = { id: '111111111111111111', name: 'G', members: empty(), channels: empty(), roles: empty(), emojis: empty(), stickers: empty(), memberCount: 1, premiumTier: 0, iconURL: () => null, bannerURL: () => null, splashURL: () => null, discoverySplashURL: () => null };
const row = { id: 'abcde-fghij', number: 1, content: 'More emojis', status: 'pending', author_id: '1', image_url: 'attachment://suggestion.png', created_at: new Date().toISOString() };
const config = { up_emoji: '👍', down_emoji: '👎', anonymous: false };
const vars = s.suggestionVars(row, config, { guild, tally: { up: 0, down: 0 }, author: null, staffName: '' });
const galleryOf = (built) => JSON.stringify(built.components.map((c) => c.toJSON?.() ?? c));
let built = await build(s.defaultDesign(config, 'pending'), { guild, suggestion: vars, allowV2: true, attachmentNames: new Set(['suggestion.png']) });
assert.ok(galleryOf(built).includes('attachment://suggestion.png'), 'the picture of the message shows in the gallery');
built = await build(s.defaultDesign(config, 'pending'), { guild, suggestion: vars, allowV2: true });
assert.ok(!galleryOf(built).includes('attachment://'), 'a file the sender did not attach is not used');
console.log('suggestions ok');
})().catch((error) => { console.error(error); process.exit(1); });
