// Checks the chart of `!stats growth`: the axis of the members line is zoomed to the real range of the data (never from zero, a minimum span, round
// ticks), the line and the bars of each day are shaped right for 1 to 180 days, with and without the count of members, and the card is drawn in the
// three languages for each of those cases and keeps every other card of `!stats` as it was.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { botDay } = require('../src/utils/botTime');
const { buildStatsV2 } = require('../src/utils/statsV2');
const { niceScale, niceStep, barTop, tickLabel, growthChart, MIN_LINE_SPAN } = require('../src/utils/growthChart');
const { t } = require('../src/i18n');

const NOW = new Date('2026-11-04T15:00:00Z');
const dayAgo = (back) => botDay(new Date(NOW.getTime() - back * 86_400_000));

/** Stats for `days` days with the joins and leaves of each day (oldest first) and the members now (null: the server has no count). */
function statsOf(joins, leaves, memberTotal) {
  const days = joins.length;
  const flowRows = joins.map((value, i) => ({ day: dayAgo(days - 1 - i), joins: value, leaves: leaves[i], invited: 0 }));
  return buildStatsV2({ days, now: NOW, flowRows, memberTotal });
}
const sum = (values) => values.reduce((a, b) => a + b, 0);
const cycle = (length, values) => Array.from({ length }, (_, i) => values[i % values.length]);

/** An axis that holds the data, with equal round steps and not too many of them. */
function assertScale(scale, values, label) {
  assert.ok(values.every((value) => value >= scale.min && value <= scale.max), `${label}: the axis holds every value`);
  assert.equal(scale.ticks[0], scale.min, `${label}: the first tick is the bottom`);
  assert.equal(scale.ticks.at(-1), scale.max, `${label}: the last tick is the top`);
  assert.ok(scale.ticks.length >= 2 && scale.ticks.length <= 6, `${label}: ${scale.ticks.length} ticks`);
  scale.ticks.forEach((tick, i) => { if (i) assert.equal(tick - scale.ticks[i - 1], scale.step, `${label}: equal steps`); });
  assert.ok([1, 2, 5].includes(scale.step / 10 ** Math.floor(Math.log10(scale.step))), `${label}: the step ${scale.step} is 1, 2 or 5 times a power of ten`);
  assert.ok(Number.isInteger(scale.step) && scale.ticks.every(Number.isInteger), `${label}: whole numbers`);
}

// --- the axis -----------------------------------------------------------------------------------------------------------------------------
{
  // The server of the screenshot: about 600 members moving between 565 and 614 is not drawn from zero.
  const scale = niceScale({ min: 565, max: 614, floor: 0 });
  assertScale(scale, [565, 614], 'wide range');
  assert.ok(scale.min >= 500 && scale.max <= 700, `the axis is zoomed (${scale.min} to ${scale.max})`);
  assert.deepEqual(scale.ticks, [540, 560, 580, 600, 620]);
  // Flat data and a range of one member get at least the minimum span, centered on the data.
  for (const [min, max] of [[600, 600], [600, 601], [598, 603], [0, 0], [1, 1]]) {
    const flat = niceScale({ min, max, floor: 0 });
    assertScale(flat, [min, max], `range ${min}-${max}`);
    assert.ok(flat.max - flat.min >= MIN_LINE_SPAN, `range ${min}-${max}: span ${flat.max - flat.min} is at least ${MIN_LINE_SPAN}`);
    assert.ok(flat.min >= 0, 'a count of members is never below zero');
  }
  const centered = niceScale({ min: 600, max: 600, floor: 0 });
  assert.ok(centered.min < 600 && centered.max > 600 && Math.abs((centered.min + centered.max) / 2 - 600) <= centered.step, 'flat data sits in the middle');
  // A change around zero keeps zero on the axis when the data holds it, and may go below it.
  const signed = niceScale({ min: -12, max: 20 });
  assertScale(signed, [-12, 20], 'signed');
  assert.ok(signed.ticks.includes(0));
  // Near the floor the axis stops at zero and keeps its span.
  const low = niceScale({ min: 1, max: 3, floor: 0 });
  assert.equal(low.min, 0);
  assert.ok(low.max - low.min >= MIN_LINE_SPAN);
  // Big servers: the steps grow with the range and the labels do not repeat.
  const big = niceScale({ min: 248_000, max: 250_100, floor: 0 });
  assertScale(big, [248_000, 250_100], 'big server');
  assert.equal(new Set(big.ticks.map((tick) => tickLabel(tick, big.step))).size, big.ticks.length, 'no two ticks share a label');
  const huge = niceScale({ min: 1_200_000, max: 1_450_000, floor: 0 });
  assert.equal(new Set(huge.ticks.map((tick) => tickLabel(tick, huge.step))).size, huge.ticks.length, 'no two ticks of a huge server share a label');
  assert.equal(tickLabel(540, 20), '540');
  assert.equal(tickLabel(20, 10, true), '+20');
  assert.equal(tickLabel(-20, 10, true), '-20');
  assert.equal(tickLabel(0, 10, true), '0');
  assert.equal(tickLabel(249_500, 500), '249.5k');
  assert.equal(tickLabel(250_000, 500), '250k');
  assert.equal(niceStep(0), 1);
  assert.equal(niceStep(3), 5);
  assert.equal(niceStep(60), 100);
  // The bars: a round top with room above the biggest day, and a minimum, so one join is not a full bar.
  assert.equal(barTop(0), 4);
  assert.equal(barTop(1), 4);
  assert.equal(barTop(9), 10);
  assert.equal(barTop(11), 12);
  assert.equal(barTop(500), 500);
  for (let biggest = 0; biggest <= 3000; biggest += 7) assert.ok(barTop(biggest) >= biggest && barTop(biggest) >= 4, `the top holds ${biggest}`);
}

// --- the shape of the chart -----------------------------------------------------------------------------------------------------------------
{
  // 30 days like the screenshot: 170 joined, 135 left, net +35, 600 members now.
  const joins = cycle(30, [5, 6, 4, 9, 7, 3, 8, 5, 6, 2]);
  const leaves = cycle(30, [4, 3, 5, 7, 2, 6, 4, 5, 3, 9]);
  const stats = statsOf(joins, leaves, 600);
  const chart = growthChart(stats);
  assert.equal(chart.kind, 'members');
  assert.equal(chart.line.values.length, 30, 'a point for each day');
  assert.equal(chart.line.end, 600, 'the line ends at the members now');
  assert.equal(chart.line.delta, sum(joins) - sum(leaves), 'the change is the net of the period');
  assert.equal(chart.line.start, 600 - chart.line.delta, 'it starts at what there was before the first day');
  chart.line.values.forEach((value, i) => { if (i) assert.equal(value - chart.line.values[i - 1], joins[i] - leaves[i], `day ${i} moves the line by its net`); });
  assert.equal(chart.line.values[0] - chart.line.start, joins[0] - leaves[0]);
  assertScale(chart.line.scale, [chart.line.start, ...chart.line.values], 'members line');
  assert.ok(chart.line.scale.min > 0, 'the members line does not start from zero');
  assert.ok(chart.line.scale.max - chart.line.scale.min < 150, 'and the axis is not much taller than the data');
  assert.deepEqual(chart.bars.joins, joins);
  assert.deepEqual(chart.bars.leaves, leaves);
  assert.equal(chart.bars.best.value, Math.max(...joins));
  assert.equal(chart.bars.best.index, joins.indexOf(Math.max(...joins)), 'the first day with the most joins');
  assert.equal(chart.bars.best.day, stats.current.days[chart.bars.best.index]);
  assert.equal(chart.bars.worst.value, Math.max(...leaves));
  assert.equal(chart.bars.worst.index, leaves.indexOf(Math.max(...leaves)));
  assert.ok(chart.bars.top >= Math.max(...joins, ...leaves));
}
{
  // Negative net: the line goes down and the change is negative.
  const stats = statsOf(cycle(14, [1, 2, 0]), cycle(14, [4, 3, 6]), 480);
  const chart = growthChart(stats);
  assert.ok(chart.line.delta < 0);
  assert.equal(chart.line.delta, chart.line.end - chart.line.start);
  assert.ok(chart.line.start > chart.line.end);
  assertScale(chart.line.scale, [chart.line.start, ...chart.line.values], 'falling line');
}
{
  // A day with nothing: no best day when nobody joined, no worst day when nobody left.
  const chart = growthChart(statsOf([0, 0, 0], [0, 2, 1], 100));
  assert.equal(chart.bars.best, null);
  assert.equal(chart.bars.worst.index, 1);
  assert.equal(chart.bars.top, 4);
  // And the line of a server where nothing changed is flat inside an axis of the minimum span.
  const flat = growthChart(statsOf(Array(10).fill(0), Array(10).fill(0), 600));
  assert.equal(flat.line.delta, 0);
  assert.ok(flat.line.values.every((value) => value === 600));
  assertScale(flat.line.scale, [600], 'flat line');
  assert.ok(flat.line.scale.max - flat.line.scale.min >= MIN_LINE_SPAN);
}
{
  // One day.
  const chart = growthChart(statsOf([7], [3], 50));
  assert.equal(chart.line.values.length, 1);
  assert.deepEqual([chart.line.start, chart.line.end, chart.line.delta], [46, 50, 4]);
  assertScale(chart.line.scale, [46, 50], 'one day');
  assert.equal(chart.bars.best.index, 0);
}
{
  // A tiny server never goes below zero.
  const chart = growthChart(statsOf([0, 1, 0, 0], [2, 0, 1, 0], 2));
  assert.ok(chart.line.values.every((value) => value >= 0));
  assert.ok(chart.line.scale.min >= 0);
}
for (const days of [7, 14, 30, 90, 180]) {
  const chart = growthChart(statsOf(cycle(days, [3, 8, 2, 5, 9, 4]), cycle(days, [2, 4, 7, 3, 1, 6]), 1000));
  assert.equal(chart.line.values.length, days);
  assert.equal(chart.bars.joins.length, days);
  assert.equal(chart.days.length, days);
  assertScale(chart.line.scale, [chart.line.start, ...chart.line.values], `${days} days`);
}
{
  // A server with no count of members: the running net change from zero, signed, with zero on the axis.
  const joins = cycle(30, [5, 6, 4, 9, 7]);
  const leaves = cycle(30, [4, 3, 5, 7, 2]);
  const chart = growthChart(statsOf(joins, leaves, null));
  assert.equal(chart.kind, 'net');
  assert.equal(chart.line.start, 0);
  assert.equal(chart.line.end, chart.line.delta);
  assert.equal(chart.line.delta, sum(joins) - sum(leaves));
  assert.equal(chart.line.values.length, 30);
  assert.equal(chart.line.values[0], joins[0] - leaves[0]);
  assertScale(chart.line.scale, [0, ...chart.line.values], 'net line');
  assert.ok(chart.line.scale.ticks.includes(0) || (chart.line.scale.min < 0 && chart.line.scale.max > 0), 'zero is on the axis');
  // Net below zero all the way: the axis goes below zero (it has no floor).
  const down = growthChart(statsOf(Array(10).fill(1), Array(10).fill(5), null));
  assert.equal(down.line.delta, -40);
  assert.ok(down.line.scale.min <= -40 && down.line.scale.max >= 0);
}

// --- the card -----------------------------------------------------------------------------------------------------------------------------
const cards = require('../src/imgutils/statsCards');
const png = (buffer) => buffer.length > 8_000 && buffer.subarray(1, 4).toString() === 'PNG' && buffer.readUInt32BE(16) === 1280 && buffer.readUInt32BE(20) === 700;
const cases = {
  'screenshot (30 days, 600 members)': statsOf(cycle(30, [5, 6, 4, 9, 7, 3, 8, 5, 6, 2]), cycle(30, [4, 3, 5, 7, 2, 6, 4, 5, 3, 9]), 600),
  '7 days': statsOf(cycle(7, [4, 2, 6, 3]), cycle(7, [1, 3, 2]), 600),
  '14 days': statsOf(cycle(14, [4, 2, 6, 3]), cycle(14, [5, 3, 7]), 310),
  '90 days': statsOf(cycle(90, [4, 2, 6, 3, 9]), cycle(90, [3, 3, 5, 8]), 600),
  '180 days': statsOf(cycle(180, [4, 2, 6, 3, 9]), cycle(180, [3, 3, 5, 8]), 4200),
  'one day': statsOf([5], [2], 600),
  'nothing happened': statsOf(Array(30).fill(0), Array(30).fill(0), 600),
  'no count of members': statsOf(cycle(30, [5, 6, 4, 9, 7]), cycle(30, [4, 3, 5, 7, 2]), null),
  'negative net': statsOf(cycle(30, [1, 2, 0]), cycle(30, [4, 3, 6]), 300),
  'big server': statsOf(cycle(30, [300, 450, 120]), cycle(30, [200, 250, 400]), 250_000),
  'tiny server': statsOf([0, 1, 0, 0, 2, 0, 0], [0, 0, 1, 0, 0, 0, 1], 3),
  'empty': buildStatsV2({ days: 30, now: NOW }),
};
for (const [name, stats] of Object.entries(cases)) {
  for (const lang of ['en', 'es', 'pt-BR']) assert.ok(png(cards.buildGrowthCard({ guildName: 'Petto', days: stats.days, stats, lang })), `${lang}: ${name}`);
}

// --- the texts ----------------------------------------------------------------------------------------------------------------------------
for (const lang of ['en', 'es', 'pt-BR']) {
  for (const key of ['info.statsCard.growth.legend.joined', 'info.statsCard.growth.legend.left']) assert.ok(t(lang, key) && t(lang, key) !== key, `${lang} ${key}`);
  for (const key of ['info.statsCard.growth.mostJoins', 'info.statsCard.growth.mostLeaves']) {
    const text = t(lang, key, { day: 'Oct 7', count: 9 });
    assert.ok(text.includes('Oct 7') && text.includes('9') && !text.includes('{'), `${lang} ${key}: ${text}`);
  }
}
assert.notEqual(t('es', 'info.statsCard.growth.mostJoins', { day: 'x', count: 1 }), t('en', 'info.statsCard.growth.mostJoins', { day: 'x', count: 1 }));

// The other cards of `!stats` keep the plain axis that starts at zero: their volumes are not flat and zero is a real baseline for them.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'imgutils', 'statsCards.js'), 'utf8');
assert.ok(/const max = niceMax\(Math\.max\(0, \.\.\.series\.flatMap/.test(source), 'lineChart keeps its axis from zero');

console.log('check-stats-growth-chart: ok');
