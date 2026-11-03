// Checks the pictures of the rank: the progress bar of the rank embed (a valid small picture for 0%, 1%, 50% and 100% and for bad values, the
// colors, the cache that keeps it, the thin text bar that replaces it) and the optional "3D glass" rank card (the size, long and emoji names,
// no rank, voice, three languages, with and without an avatar).
const assert = require('node:assert/strict');
const { loadImage, createCanvas } = require('@napi-rs/canvas');

const { renderRankBar, clearRankBars, rankBarCacheSize, barColor, DEFAULT_COLOR, VOICE_COLOR } = require('../src/utils/rankBar');
const { buildThinBar } = require('../src/utils/levelProgressBar');
const { drawGlassRankCard, renderGlassRankCard, WIDTH, HEIGHT } = require('../src/imgutils/glassRankCard');

const isWebp = (buffer) => buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
const isPng = (buffer) => buffer.subarray(1, 4).toString('latin1') === 'PNG';

(async () => {
  // The bar: a small valid WebP of 640x40 for any percentage, and for values that are not one.
  for (const percent of [0, 1, 50, 64, 100, -5, 150, Number.NaN, '33', undefined]) {
    const bar = await renderRankBar({ percent });
    assert.ok(isWebp(bar.buffer), `a WebP for ${percent}`);
    assert.equal(bar.name, 'rank-bar.webp', 'the name never changes');
    assert.ok(bar.buffer.length > 500 && bar.buffer.length < 8_000, `a small file (${bar.buffer.length} bytes) for ${percent}`);
    const image = await loadImage(bar.buffer);
    assert.deepEqual([image.width, image.height], [640, 40], 'about 640x40');
  }
  const [empty, one, half, full] = await Promise.all([0, 1, 50, 100].map((percent) => renderRankBar({ percent })));
  assert.equal(new Set([empty, one, half, full].map((bar) => bar.buffer.toString('base64'))).size, 4, 'each percentage looks different');
  assert.equal((await renderRankBar({ percent: 150 })).buffer, full.buffer, '150 is the same bar as 100 (clamped)');
  assert.equal((await renderRankBar({ percent: -5 })).buffer, empty.buffer, 'and below 0 is 0');

  // The fill really is where it should be: the pixel near the end of a half bar is the fill, past it is the track.
  async function pixel(percent, x, y = 20) {
    const canvas = createCanvas(640, 40); const ctx = canvas.getContext('2d');
    ctx.drawImage(await loadImage((await renderRankBar({ percent })).buffer), 0, 0);
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data; return r + g + b;
  }
  assert.ok(await pixel(50, 200) > 400 && await pixel(50, 500) < 150, 'a half bar is filled to the middle and dark after it');
  assert.ok(await pixel(0, 200) < 150, 'an empty bar has no fill');
  assert.ok(await pixel(1, 14) > 400, 'one percent is still a visible dot');
  assert.ok(await pixel(100, 620) > 400, 'a full bar is filled to the end');

  // The colors: Petto's peach for messages, teal for voice, the one given when it is a hex, never a value that is not.
  assert.equal(barColor(undefined), DEFAULT_COLOR); assert.equal(barColor(undefined, true), VOICE_COLOR);
  assert.equal(barColor('#A1B2C3'), '#a1b2c3'); assert.equal(barColor('red; drop'), DEFAULT_COLOR); assert.equal(barColor(0xff0000), DEFAULT_COLOR);
  const voiceBar = await renderRankBar({ percent: 50, voice: true });
  assert.notEqual(voiceBar.buffer.toString('base64'), half.buffer.toString('base64'), 'voice has its own color');
  assert.equal((await renderRankBar({ percent: 50, color: VOICE_COLOR })).buffer, voiceBar.buffer, 'the same color is the same cached bar whoever asks');

  // The cache: the second ask is the same object with no drawing, two at once share one drawing, and it never grows without a limit.
  clearRankBars();
  const first = await renderRankBar({ percent: 42 });
  assert.equal(await renderRankBar({ percent: 42 }), first, 'a hit gives the very same object');
  const both = await Promise.all([renderRankBar({ percent: 43 }), renderRankBar({ percent: 43 })]);
  assert.equal(both[0], both[1], 'two at the same time share one render');
  const started = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) await renderRankBar({ percent: 42 });
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 100, 'a thousand cached bars take almost no time');
  process.env.RANK_BAR_CACHE_ENTRIES = '16';
  clearRankBars();
  for (let percent = 0; percent < 30; percent++) await renderRankBar({ percent });
  assert.equal(rankBarCacheSize().entries, 16, 'the oldest bars go when the limit is reached');
  await renderRankBar({ percent: 29 });
  assert.equal(rankBarCacheSize().entries, 16);
  delete process.env.RANK_BAR_CACHE_ENTRIES;
  process.env.RANK_BAR_FORMAT = 'png';
  const png = await renderRankBar({ percent: 10 });
  assert.ok(isPng(png.buffer) && png.name === 'rank-bar.png', 'PNG when the host asks for it');
  delete process.env.RANK_BAR_FORMAT;
  clearRankBars();

  // The thin text bar used when the picture cannot be attached: plain characters, no emoji.
  assert.equal(buildThinBar(0), '─'.repeat(20)); assert.equal(buildThinBar(100), '━'.repeat(20));
  assert.equal(buildThinBar(50), '━'.repeat(10) + '─'.repeat(10)); assert.equal(buildThinBar(500).length, 20); assert.equal(buildThinBar(-3), '─'.repeat(20));
  assert.ok(!/<:|\p{Extended_Pictographic}/u.test(buildThinBar(37)));

  // The optional glass card.
  const data = (extra = {}) => ({ level: 83, xp: 5_432_100, xpNeeded: 9_800, xpCurrent: 6_320, xpToNext: 3_480, progress: 64, rank: 12, total: 72_159, source: 'text', ...extra });
  const avatar = createCanvas(128, 128); avatar.getContext('2d').fillStyle = '#4488ff'; avatar.getContext('2d').fillRect(0, 0, 128, 128);
  const cases = [
    { data: data({ progress: 0, xpCurrent: 0 }), name: 'Mochi' },
    { data: data({ progress: 1 }), name: 'Mochi', avatar },
    { data: data({ progress: 50 }), name: 'A'.repeat(80), avatar },
    { data: data({ progress: 100, xpCurrent: 9_800 }), name: 'Wide Wide Wide Wide Wide Wide Wide Wide', avatar },
    { data: data(), name: 'Mochi 🐱🔥 ✨', avatar },
    { data: data({ rank: null, total: null }), name: 'Nobody' },
    { data: data({ rank: 3, total: null }), name: 'No total' },
    { data: data({ source: 'voice' }), name: 'Voice', source: 'voice', avatar },
    { data: data(), name: 'Nombre', lang: 'es' },
    { data: data(), name: 'Nome', lang: 'pt-BR', accent: '#ff5599' },
    { data: data({ level: 0, xp: 0, xpCurrent: 0, xpNeeded: 100, progress: 0, rank: null }), name: '' },
  ];
  for (const options of cases) {
    const canvas = drawGlassRankCard(options);
    assert.deepEqual([canvas.width, canvas.height], [WIDTH, HEIGHT], 'the size is 900x300');
  }
  const card = await renderGlassRankCard(cases[4]);
  assert.ok(isWebp(card) && card.length > 5_000 && card.length < 60_000, `the card is a WebP of a sensible size (${card.length} bytes)`);
  assert.notEqual((await renderGlassRankCard({ ...cases[0] })).toString('base64'), (await renderGlassRankCard({ ...cases[3] })).toString('base64'));
  assert.notEqual((await renderGlassRankCard(cases[8])).toString('base64'), (await renderGlassRankCard({ ...cases[8], lang: 'pt-BR' })).toString('base64'), 'the words follow the language');
  console.log('Checked the rank progress bar picture (sizes, colors, cache, fallback) and the optional glass card.');
})().catch((error) => { console.error(error); process.exit(1); });
