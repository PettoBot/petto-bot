// Checks the picture of the progress bar of the rank embed: a valid small flat picture of 640x56 for 0%, 1%, 50% and 100% and for bad values, in
// the three themes (normal, Halloween, Christmas), the colors, the theme of the date and the RANK_BAR_THEME override, the cache that keeps it
// (by theme, percentage and color) and the thin text bar that replaces it.
const assert = require('node:assert/strict');
const { loadImage, createCanvas } = require('@napi-rs/canvas');

const { renderRankBar, clearRankBars, rankBarCacheSize, barColor, themeFor, currentTheme, THEMES } = require('../src/utils/rankBar');
const { themeColor } = require('../src/imgutils/progressBarImage');
const { buildThinBar } = require('../src/utils/levelProgressBar');

const isWebp = (buffer) => buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
const isPng = (buffer) => buffer.subarray(1, 4).toString('latin1') === 'PNG';
const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const near = (a, b, tolerance = 14) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
const base64 = (bar) => bar.buffer.toString('base64');

(async () => {
  delete process.env.RANK_BAR_THEME;
  // The theme of a date: Halloween October 15 to November 2, Christmas December 1 to January 5, normal otherwise.
  const day = (text) => themeFor(new Date(`${text}T12:00:00Z`));
  assert.deepEqual(['2026-10-14', '2026-10-15', '2026-11-02', '2026-11-03', '2026-11-30', '2026-12-01', '2027-01-05', '2027-01-06', '2026-07-01'].map(day),
    ['normal', 'halloween', 'halloween', 'normal', 'normal', 'christmas', 'christmas', 'normal', 'normal']);
  assert.deepEqual(THEMES, ['normal', 'halloween', 'christmas']);
  for (const [value, expected] of [['halloween', 'halloween'], ['Christmas', 'christmas'], [' normal ', 'normal'], ['auto', day('2026-10-20')], ['nonsense', day('2026-10-20')], ['', day('2026-10-20')]]) {
    process.env.RANK_BAR_THEME = value;
    assert.equal(currentTheme(new Date('2026-10-20T12:00:00Z')), expected, `RANK_BAR_THEME=${value}`);
  }
  process.env.RANK_BAR_THEME = 'normal';
  assert.equal(currentTheme(new Date('2026-12-25T12:00:00Z')), 'normal', 'the override wins over the date');
  delete process.env.RANK_BAR_THEME;

  // The bar: a small valid PNG of 640x56 for any percentage, in every theme, and for values that are not one.
  for (const theme of THEMES) {
    for (const percent of [0, 1, 50, 64, 100, -5, 150, Number.NaN, '33', undefined]) {
      const bar = await renderRankBar({ percent, theme });
      assert.ok(isPng(bar.buffer), `a PNG for ${percent} in ${theme}`);
      assert.equal(bar.name, 'rank-bar.png', 'the name never changes');
      assert.ok(bar.buffer.length > 300 && bar.buffer.length < 20_000, `a small file (${bar.buffer.length} bytes) for ${percent} in ${theme}`);
      const image = await loadImage(bar.buffer);
      assert.deepEqual([image.width, image.height], [640, 56], 'the same size in every theme');
    }
    const [empty, one, half, full] = await Promise.all([0, 1, 50, 100].map((percent) => renderRankBar({ percent, theme })));
    assert.equal(new Set([empty, one, half, full].map(base64)).size, 4, `each percentage looks different in ${theme}`);
    assert.equal((await renderRankBar({ percent: 150, theme })).buffer, full.buffer, '150 is the same bar as 100 (clamped)');
    assert.equal((await renderRankBar({ percent: -5, theme })).buffer, empty.buffer, 'and below 0 is 0');
  }
  assert.equal(new Set(await Promise.all(THEMES.map(async (theme) => base64(await renderRankBar({ percent: 64, theme }))))).size, 3, 'the three themes look different');
  assert.notEqual(base64(await renderRankBar({ percent: 64, theme: 'normal' })), base64(await renderRankBar({ percent: 64, theme: 'normal', voice: true })), 'voice has its own color in every theme');
  assert.notEqual(base64(await renderRankBar({ percent: 64, theme: 'halloween', voice: true })), base64(await renderRankBar({ percent: 64, theme: 'halloween' })));

  // The fill is where it should be and flat: in the middle of the pill, the fill color up to the percentage and the track color after it.
  async function pixel(theme, percent, x, voice = false) {
    const canvas = createCanvas(640, 56); const ctx = canvas.getContext('2d');
    ctx.drawImage(await loadImage((await renderRankBar({ percent, theme, voice })).buffer), 0, 0);
    return [...ctx.getImageData(x, 28, 1, 1).data].slice(0, 3);
  }
  const tracks = { normal: '#ffffff', halloween: '#2b1646' };
  for (const theme of ['normal', 'halloween']) {
    assert.ok(near(await pixel(theme, 50, 200), rgb(themeColor(theme))), `${theme}: the fill color up to the middle`);
    assert.ok(near(await pixel(theme, 50, 500), rgb(tracks[theme])), `${theme}: the track after it`);
    assert.ok(near(await pixel(theme, 50, 200, true), rgb(themeColor(theme, true))), `${theme}: voice fill`);
    assert.ok(near(await pixel(theme, 0, 200), rgb(tracks[theme])), `${theme}: an empty bar has no fill`);
    assert.ok(near(await pixel(theme, 1, 16), rgb(themeColor(theme))), `${theme}: one percent is still a visible dot`);
    assert.ok(near(await pixel(theme, 100, theme === 'halloween' ? 580 : 620), rgb(themeColor(theme))), `${theme}: a full bar is filled to the end`);
  }
  const corner = createCanvas(640, 56).getContext('2d');
  corner.drawImage(await loadImage((await renderRankBar({ percent: 50, theme: 'normal' })).buffer), 0, 0);
  assert.equal(corner.getImageData(4, 4, 1, 1).data[3], 0, 'the normal theme draws nothing around the pill');
  const night = createCanvas(640, 56).getContext('2d');
  night.drawImage(await loadImage((await renderRankBar({ percent: 50, theme: 'halloween' })).buffer), 0, 0);
  assert.ok(night.getImageData(610, 8, 1, 1).data[3] > 200 && near([...night.getImageData(610, 8, 1, 1).data].slice(0, 3), [244, 240, 255], 30), 'Halloween has a ghost near the right end');
  const pill = (data) => [...data.getImageData(630, 28, 1, 1).data];
  assert.ok(pill(night)[3] > 200, 'and its pill is as long as the others (it reaches the right end)');

  // The colors: the theme's own for messages and for voice, the one given when it is a hex, never a value that is not.
  assert.equal(barColor(undefined, false, 'normal'), '#6485a7'); assert.equal(barColor(undefined, true, 'normal'), themeColor('normal', true));
  assert.equal(barColor(undefined, false, 'halloween'), '#ff8c1a'); assert.equal(barColor(undefined, false, 'christmas'), '#d8283a');
  assert.equal(barColor('#A1B2C3'), '#a1b2c3'); assert.equal(barColor('red; drop', false, 'normal'), '#6485a7'); assert.equal(barColor(0xff0000, false, 'normal'), '#6485a7');
  const custom = await renderRankBar({ percent: 50, theme: 'normal', color: '#ff0000' });
  assert.ok(near(await pixel('normal', 50, 200), rgb('#6485a7')));
  assert.notEqual(base64(custom), base64(await renderRankBar({ percent: 50, theme: 'normal' })), 'a color of the server is used');
  assert.equal((await renderRankBar({ percent: 50, theme: 'normal', color: '#6485A7' })).buffer, (await renderRankBar({ percent: 50, theme: 'normal' })).buffer, 'the same color is the same cached bar whoever asks');

  // The default theme is the one of today (or of RANK_BAR_THEME).
  process.env.RANK_BAR_THEME = 'christmas';
  assert.equal((await renderRankBar({ percent: 64 })).buffer, (await renderRankBar({ percent: 64, theme: 'christmas' })).buffer);
  process.env.RANK_BAR_THEME = 'halloween';
  assert.equal((await renderRankBar({ percent: 64 })).buffer, (await renderRankBar({ percent: 64, theme: 'halloween' })).buffer, 'the theme follows the setting at the moment of the reply');
  delete process.env.RANK_BAR_THEME;

  // The cache: the second ask is the same object with no drawing, two at once share one drawing, and it never grows without a limit.
  clearRankBars();
  const first = await renderRankBar({ percent: 42, theme: 'normal' });
  assert.equal(await renderRankBar({ percent: 42, theme: 'normal' }), first, 'a hit gives the very same object');
  assert.notEqual(await renderRankBar({ percent: 42, theme: 'christmas' }), first, 'the theme is part of the key');
  const both = await Promise.all([renderRankBar({ percent: 43, theme: 'normal' }), renderRankBar({ percent: 43, theme: 'normal' })]);
  assert.equal(both[0], both[1], 'two at the same time share one render');
  const started = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) await renderRankBar({ percent: 42, theme: 'normal' });
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 100, 'a thousand cached bars take almost no time');
  process.env.RANK_BAR_CACHE_ENTRIES = '16';
  clearRankBars();
  for (let percent = 0; percent < 30; percent++) await renderRankBar({ percent, theme: 'normal' });
  assert.equal(rankBarCacheSize().entries, 16, 'the oldest bars go when the limit is reached');
  delete process.env.RANK_BAR_CACHE_ENTRIES;
  process.env.RANK_BAR_FORMAT = 'webp';
  const webp = await renderRankBar({ percent: 10, theme: 'normal' });
  assert.ok(isWebp(webp.buffer) && webp.name === 'rank-bar.webp', 'WebP when the host asks for it');
  delete process.env.RANK_BAR_FORMAT;
  clearRankBars();

  // The thin text bar used when the picture cannot be attached: plain characters, no emoji.
  assert.equal(buildThinBar(0), '─'.repeat(20)); assert.equal(buildThinBar(100), '━'.repeat(20));
  assert.equal(buildThinBar(50), '━'.repeat(10) + '─'.repeat(10)); assert.equal(buildThinBar(500).length, 20); assert.equal(buildThinBar(-3), '─'.repeat(20));
  assert.ok(!/<:|\p{Extended_Pictographic}/u.test(buildThinBar(37)));
  console.log('Checked the rank progress bar picture (three flat themes, sizes, colors, date and override, cache, fallback).');
})().catch((error) => { console.error(error); process.exit(1); });
