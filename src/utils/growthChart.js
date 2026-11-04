// What the growth card of `!stats` draws, as plain numbers (no canvas, so it can be tested): the members line over the days with an axis zoomed to
// the real range of the data, and the joins and leaves of each day as bars on either side of a zero line. The card draws what this returns.

const STEPS = [1, 2, 5];
const MIN_LINE_SPAN = 6; // a line that moves less than this still gets a span of this many members, so one member does not look like a cliff
const MIN_BAR_TOP = 4; // the bars of a quiet server: one join is a quarter of the height at most
const BAR_TOPS = [1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The smallest 1, 2 or 5 times a power of ten that is at least `value` (and at least 1: the axis counts members). */
function niceStep(value) {
  const raw = Math.max(1, value);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return STEPS.map((multiple) => multiple * magnitude).concat(magnitude * 10).find((candidate) => candidate >= raw);
}

/**
 * An axis that fits the data instead of starting at zero: from `min` to `max` with `padding` of the span on each side, at least `minSpan` high
 * (centered on the data), never below `floor` when there is one, and ticks at round numbers (`maxTicks` at most). Returns { min, max, step, ticks }.
 */
function niceScale({ min, max, minSpan = MIN_LINE_SPAN, padding = 0.12, maxTicks = 6, floor = null }) {
  let low = Math.min(min, max);
  let high = Math.max(min, max);
  if (high - low < minSpan) {
    const middle = (low + high) / 2;
    low = middle - minSpan / 2;
    high = middle + minSpan / 2;
  }
  if (floor !== null && low < floor) { high += floor - low; low = floor; }
  const pad = (high - low) * padding;
  low -= pad;
  high += pad;
  if (floor !== null) low = Math.max(low, floor);
  for (let step = niceStep(1); ; step = niceStep(step + 1)) {
    const first = Math.floor(low / step) * step;
    const last = Math.ceil(high / step) * step;
    const count = Math.round((last - first) / step) + 1;
    if (count <= maxTicks) return { min: first, max: last, step, ticks: Array.from({ length: count }, (_, i) => first + i * step) };
  }
}

/** The top of the bars: the biggest day with a little room above it, at a round number. */
function barTop(biggest) {
  const needed = Math.max(MIN_BAR_TOP, biggest);
  const magnitude = 10 ** Math.floor(Math.log10(needed));
  const base = needed / magnitude;
  return (BAR_TOPS.find((candidate) => candidate >= base) ?? 10) * magnitude;
}

/** The label of a tick: whole numbers, with a sign when the axis is a change, and a "k" or "m" only when the step is big enough for it not to repeat. */
function tickLabel(value, step, signed = false) {
  const sign = signed && value > 0 ? '+' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000 && step >= 100_000) return `${sign}${(value / 1_000_000).toFixed(1).replace('.0', '')}m`;
  if (abs >= 1_000 && step >= 500) return `${sign}${(value / 1_000).toFixed(step % 1000 === 0 ? 0 : 1).replace('.0', '')}k`;
  return `${sign}${Math.round(value)}`;
}

/** The index of the biggest value, the first one when several are equal, or -1 when there is nothing above zero. */
const peakIndex = (values) => {
  let best = -1;
  values.forEach((value, i) => { if (value > 0 && (best < 0 || value > values[best])) best = i; });
  return best;
};

/**
 * The chart of `stats.growth` (from buildStatsV2). `line` is what the members did: with the count of members (`kind: 'members'`) it is the members at the
 * end of each day, and `start` is what there was before the first day; without it (`kind: 'net'`) it is the running net change from zero. `delta` is the
 * change over the whole period. `bars` are the joins and the leaves of each day, with the day of most joins (`best`) and of most leaves (`worst`).
 */
function growthChart(stats) {
  const { series, days } = stats.current;
  const net = series.net;
  const counted = Array.isArray(stats.growth.memberLine);
  let values;
  let start;
  if (counted) {
    values = stats.growth.memberLine;
    start = Math.max(0, values[0] - net[0]);
  } else {
    let running = 0;
    values = net.map((value) => (running += value));
    start = 0;
  }
  const points = [start, ...values];
  const scale = niceScale({ min: Math.min(...points), max: Math.max(...points), floor: counted ? 0 : null });
  const top = barTop(Math.max(0, ...series.joins, ...series.leaves));
  const best = peakIndex(series.joins);
  const worst = peakIndex(series.leaves);
  return {
    kind: counted ? 'members' : 'net',
    days,
    line: { values, start, end: values[values.length - 1], delta: values[values.length - 1] - start, scale },
    bars: {
      joins: series.joins, leaves: series.leaves, top,
      best: best < 0 ? null : { index: best, day: days[best], value: series.joins[best] },
      worst: worst < 0 ? null : { index: worst, day: days[worst], value: series.leaves[worst] },
    },
  };
}

module.exports = { niceScale, niceStep, barTop, tickLabel, growthChart, MIN_LINE_SPAN };
