// Checks the cosmetics: the picture of an avatar with its decoration (still and moving) and the `!usercosmetics` card. The pictures
// Discord would serve are replaced, so it runs without a network.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { encodeApng, decodeApng, readChunks } = require('../src/imgutils/apng');

const ring = (color) => { const c = createCanvas(256, 256); const g = c.getContext('2d'); g.strokeStyle = color; g.lineWidth = 20; g.beginPath(); g.arc(128, 128, 110, 0, Math.PI * 2); g.stroke(); return c.toBuffer('image/png'); };
const moving = encodeApng({ png: ring('#ff0000'), delayMs: 80 }, [{ png: ring('#00ff00'), x: 0, y: 0, delayMs: 80 }, { png: ring('#0000ff'), x: 0, y: 0, delayMs: 80 }]);
const asked = [];
const safePath = path.join(__dirname, '../src/utils/safeImage.js');
const real = require(safePath);
const { loadImage } = require('@napi-rs/canvas');
require.cache[require.resolve(safePath)].exports = {
  ...real,
  fetchImageBuffer: async (link) => { asked.push(link); return link.includes('passthrough=true') ? moving : ring('#ff00ff'); },
  loadImageFromLink: async () => loadImage(ring('#888888')),
  decode: (buffer) => loadImage(buffer),
};
const { renderProfileLook } = require('../src/utils/profileLookImage');

const user = (over = {}) => ({
  id: '293504726505357312', username: 'liam', globalName: 'Liam', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png',
  avatarDecorationURL: () => 'https://cdn.discordapp.com/avatar-decoration-presets/a_abc.png', avatarDecorationData: { asset: 'a_abc', skuId: '1' },
  collectibles: { nameplate: { asset: 'nameplates/nameplates/twilight/', label: 'Twilight', palette: 'cobalt', skuId: '2' } },
  primaryGuild: { identityEnabled: true, tag: 'PTT', identityGuildId: '1414452131850879080', badge: 'abcdef0123456789' }, ...over,
});

(async () => {
  const types = (buffer) => readChunks(buffer).map((chunk) => chunk.type);
  const still = await renderProfileLook(user(), { moving: false });
  assert.equal(still.name, 'look.png');
  assert.ok(!types(still.buffer).includes('acTL'), 'a still look is a plain PNG');
  const image = await loadImage(still.buffer);
  assert.equal(image.width, 288, 'the decoration is a fifth bigger than the avatar');
  assert.ok(asked.every((link) => link.includes('passthrough=false')), 'the still look asks for the still decoration');

  const animated = await renderProfileLook(user(), { moving: true });
  assert.equal(animated.moving, true);
  assert.ok(types(animated.buffer).includes('acTL'), 'a decoration that moves gives an animated PNG');
  assert.equal((await decodeApng(animated.buffer, { maxSide: 512 })).length, 3);
  const notMoving = await renderProfileLook(user({ avatarDecorationData: { asset: 'abc' } }), { moving: true });
  assert.ok(!types(notMoving.buffer).includes('acTL'), 'a decoration that does not move stays still');
  assert.equal(await renderProfileLook(user({ avatarDecorationURL: () => null }), { moving: true }), null, 'no decoration, no picture');

  // The card of !usercosmetics.
  const cmd = require('../src/commands/info/usercosmetics');
  assert.deepEqual(cmd.aliases.slice(0, 1), ['uc']);
  const run = async (u) => {
    let payload = null;
    await cmd.execute({
      guild: null, user: u, client: { users: { fetch: async () => u } }, options: { getUser: () => null },
      reply: async (p) => { payload = p; },
    });
    return payload;
  };
  const rich = await run(user());
  const json = JSON.stringify(rich.components[0].toJSON());
  for (const part of ['PTT', 'Twilight', 'cobalt', 'twilight/static.png', 'attachment://look.png', 'passthrough=true', 'guild-tag-badges']) assert.ok(json.includes(part), `the card says ${part}`);
  assert.ok(!json.includes('accent_color'), 'no color on the side');
  assert.equal(rich.files.length, 1, 'the look is attached');
  assert.equal(rich.flags, 32768);
  const buttons = rich.components[0].toJSON().components.find((c) => c.type === 1).components;
  assert.ok(buttons.length <= 5 && buttons.every((b) => b.url.startsWith('https://cdn.discordapp.com/')), 'link buttons to the pictures');
  const empty = await run(user({ avatarDecorationURL: () => null, avatarDecorationData: null, collectibles: null, primaryGuild: null }));
  assert.equal(empty.files.length, 0);
  assert.ok(JSON.stringify(empty.components[0].toJSON()).includes('None'), 'a member with nothing says so');
  console.log('Checked the avatar look, the moving decoration and the cosmetics card.');
})().catch((error) => { console.error(error); process.exit(1); });
