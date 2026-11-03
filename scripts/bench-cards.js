// Times the pictures of the rank with fake data and no network: the default rank card (the layered card renderer, unchanged), the new progress
// bar of the rank embed (first render and cached) and the optional glass card. Not part of `npm run check`.
//   node scripts/bench-cards.js            all of them
//   node scripts/bench-cards.js legacy     only the default rank card, step by step (fonts, background, avatar, drawing, encode)
//   node scripts/bench-cards.js bar        only the progress bar, with PNG vs WebP vs JPEG
//   node scripts/bench-cards.js board      only the leaderboard with the podium picture
//   node scripts/bench-cards.js glass      only the optional glass card
// A cold time needs a fresh process, so run one mode at a time to see it.
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { Collection } = require('discord.js');


function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/imageCards.js', { getCard: async () => null });
stub('src/db/cardAssets.js', { getAsset: async () => null });
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: false }) });

const now = () => Number(process.hrtime.bigint()) / 1e6;
const fixed = (value) => (Number.isFinite(value) ? value.toFixed(1) : '-');
async function timed(fn) { const start = now(); const value = await fn(); return [now() - start, value]; }

/** A fake avatar: a small PNG drawn in memory, so no network is needed. */
function fakeAvatar(size, hue) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, `hsl(${hue} 80% 60%)`); gradient.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 40%)`);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
  return canvas.toBuffer('image/png');
}

const LEVEL_DATA = { level: 83, xp: 5_432_100, xpNeeded: 9_800, xpCurrent: 6_320, xpToNext: 3_480, progress: 64, rank: 12, total: 72_159, source: 'text' };

async function legacy() {
  const { registerCardFonts } = require('../src/imgutils/cardFonts');
  const { loadDesignImage } = require('../src/utils/cardDesigns');
  const { decode } = require('../src/utils/safeImage');
  const { defaultRankCard, drawCard } = require('../src/utils/cardService');
  // Count the encode step by wrapping the canvas method that writes the PNG.
  const proto = Object.getPrototypeOf(createCanvas(1, 1));
  const original = proto.toBuffer;
  let encodeMs = 0;
  proto.toBuffer = function patched(...args) { const start = now(); try { return original.apply(this, args); } finally { encodeMs += now() - start; } };

  const avatarBytes = fakeAvatar(512, 20);
  const user = { id: '1', username: 'Mochi', displayName: 'Mochi', displayAvatarURL: () => null, createdAt: new Date() };
  const guild = { id: '9', name: 'Petto', memberCount: 5, premiumTier: 0, premiumSubscriptionCount: 0, iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() } };
  const member = { id: '1', user, displayName: 'Mochi', displayAvatarURL: () => null, joinedTimestamp: 1, roles: { cache: new Collection(), highest: { name: 'Member' } }, premiumSince: null };
  const ctx = { guild, member, user, levelData: LEVEL_DATA };

  const [fontMs] = await timed(async () => registerCardFonts());
  const [backgroundMs] = await timed(() => loadDesignImage('rank-default', 'rank'));
  const [avatarMs] = await timed(() => decode(avatarBytes));
  const runs = [];
  for (let i = 0; i < 6; i++) {
    encodeMs = 0;
    const [total, buffer] = await timed(() => drawCard(defaultRankCard('messages'), ctx, { guildId: '9', premium: false, lang: 'en' }));
    runs.push({ total, encode: encodeMs, bytes: buffer.length });
  }
  proto.toBuffer = original;
  const warm = runs.slice(1).sort((a, b) => a.total - b.total)[Math.floor((runs.length - 1) / 2)];
  console.log('LEGACY default rank card (layered renderer, PNG)');
  console.log(`  steps measured on their own: fonts ${fixed(fontMs)} ms, background decode ${fixed(backgroundMs)} ms, avatar decode (512 px) ${fixed(avatarMs)} ms`);
  console.log(`  first render (the fonts above are already loaded; the background loads inside): total ${fixed(runs[0].total)} ms, of which encode ${fixed(runs[0].encode)} ms, drawing and the rest ${fixed(runs[0].total - runs[0].encode)} ms`);
  console.log(`  warm  (median of 5): total ${fixed(warm.total)} ms, of which encode ${fixed(warm.encode)} ms, drawing ${fixed(warm.total - warm.encode)} ms; ${warm.bytes} bytes`);
  console.log('  leaderboard before: an embed (no image), nothing to draw');
}

async function bar() {
  const { renderRankBar, clearRankBars } = require('../src/utils/rankBar');
  const { drawProgressBar } = require('../src/imgutils/progressBarImage');
  console.log('RANK BAR picture (640x40, WebP)');
  const cold = [];
  for (const percent of [64, 12, 100, 0, 1, 47, 83, 5]) cold.push((await timed(() => renderRankBar({ percent })))[0]);
  console.log(`  first render of a bar: ${fixed(cold[0])} ms the very first (drawing and encoding warm-up), then ${fixed(cold.slice(1).reduce((a, b) => a + b, 0) / (cold.length - 1))} ms on average`);
  const hits = [];
  for (let i = 0; i < 200; i++) hits.push((await timed(() => renderRankBar({ percent: 64 })))[0]);
  hits.sort((a, b) => a - b);
  console.log(`  the same bar again (cache hit): median ${hits[100].toFixed(3)} ms`);
  const sample = drawProgressBar(64, '#ffb199');
  for (const [type, quality] of [['webp', 92], ['webp', 80], ['png', undefined], ['jpeg', 90]]) {
    const times = []; let bytes = 0;
    for (let i = 0; i < 15; i++) { const [ms, buffer] = await timed(() => sample.encode(type, quality)); times.push(ms); bytes = buffer.length; }
    times.sort((a, b) => a - b);
    console.log(`  encode ${type}${quality ? ` q${quality}` : ''}: median ${fixed(times[7])} ms, ${bytes} bytes${type === 'jpeg' ? ' (no transparency)' : ''}`);
  }
  clearRankBars();
}

async function board() {
  const { totalXpForLevel } = require('../src/utils/levelCurve');
  const cfg = { curve_a: 1, curve_b: 50, curve_c: 100, difficulty: 2.5, rounding: 50, enabled: true };
  stub('src/db/levelUsers.js', {
    getLeaderboardPage: async () => Array.from({ length: 10 }, (_, i) => ({ user_id: String(1000 + i), level: 83 - i * 5, xp: totalXpForLevel(83 - i * 5, cfg) + 300 })),
    getUser: async () => ({ xp: totalXpForLevel(41, cfg) + 900, level: 41 }), getRank: async () => 312,
  });
  stub('src/db/levelPeriods.js', {});
  const { setAvatarFetcher, clearAvatars } = require('../src/utils/avatarCache');
  const { buildLeaderboardReply, clearBoardImages } = require('../src/utils/leaderboardView');
  const png = fakeAvatar(128, 200);
  setAvatarFetcher(async () => png); // a download that takes no time: the real one adds its network time, the first time only
  const guild = { id: '9', name: 'Petto Server', iconURL: () => null, members: { cache: new Collection(Array.from({ length: 10 }, (_, i) => [String(1000 + i), { displayName: `Member ${i + 1}`, displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${i}/h${i}.png` }])) } };
  const args = { guild, page: 1, totalPages: 7216, total: 72_159, config: cfg, lang: 'en', viewerId: '77' };
  const [fontMs] = await timed(async () => require('../src/imgutils/cardFonts').registerCardFonts());
  const [first, reply] = await timed(() => buildLeaderboardReply(args));
  const runs = [];
  for (let i = 0; i < 9; i++) { clearBoardImages(); runs.push((await timed(() => buildLeaderboardReply(args)))[0]); }
  runs.sort((a, b) => a - b);
  const hits = [];
  for (let i = 0; i < 50; i++) hits.push((await timed(() => buildLeaderboardReply(args)))[0]);
  hits.sort((a, b) => a - b);
  clearAvatars();
  console.log('LEADERBOARD podium picture + table + your position (900x380 WebP)');
  console.log(`  fonts ${fixed(fontMs)} ms; first page built (cold, includes drawing the podium, the bar and 3 avatar decodes): ${fixed(first)} ms; ${reply.files.map((f) => `${f.name} ${f.attachment.length} B`).join(', ')}`);
  console.log(`  podium drawn again (avatars cached, picture not): median ${fixed(runs[4])} ms; page with every picture cached: median ${hits[25].toFixed(2)} ms (this includes the table and the embeds)`);
}

async function glass() {
  const { renderGlassRankCard } = require('../src/imgutils/glassRankCard');
  const { registerCardFonts } = require('../src/imgutils/cardFonts');
  const [fontMs] = await timed(async () => registerCardFonts());
  const runs = [];
  for (let i = 0; i < 8; i++) runs.push(await timed(() => renderGlassRankCard({ data: LEVEL_DATA, name: 'Mochi', avatar: null, lang: 'en' })));
  const warm = runs.slice(1).map((run) => run[0]).sort((a, b) => a - b)[3];
  console.log('OPTIONAL glass rank card (900x300, WebP, not wired to anything)');
  console.log(`  fonts ${fixed(fontMs)} ms, first render ${fixed(runs[0][0])} ms, warm median ${fixed(warm)} ms, ${runs[0][1].length} bytes`);
}

(async () => {
  const mode = process.argv[2] ?? 'all';
  if (mode === 'legacy' || mode === 'all') await legacy();
  if (mode === 'bar' || mode === 'all') await bar();
  if (mode === 'board' || mode === 'all') await board();
  if (mode === 'glass' || mode === 'all') await glass();
})().catch((error) => { console.error(error); process.exit(1); });
