// i18n-ignore-file: Petto team operator tool, only the owner and the developers see it.
// A CPU profile of the running bot for a few seconds: which functions and which files use the processor. It only samples while it runs
// (the profiler of Node is off the rest of the time), only one runs at a time and it is refused when the bot is already struggling.
const inspector = require('node:inspector');

const MIN_SECONDS = 3;
const MAX_SECONDS = 30;
const DEFAULT_SECONDS = 10;
const SAMPLING_US = 1000; // one sample per millisecond of the work that runs

let running = false;

/** `file:///app/src/utils/x.js` or `/app/node_modules/pkg/y.js` as `src/utils/x.js` / `pkg/y.js`; what is not a file stays as it is. */
function shortUrl(url) {
  if (!url) return '(native)';
  const path = String(url).replace(/^file:\/\//, '').replace(/^node:/, 'node:');
  const modules = path.lastIndexOf('node_modules/');
  if (modules >= 0) return path.slice(modules + 'node_modules/'.length);
  const src = path.lastIndexOf('/src/');
  if (src >= 0) return path.slice(src + 1);
  return path.split('/').slice(-2).join('/');
}

/**
 * The time each function used itself (not counting what it called), from a profile of the inspector (`nodes`, `samples`, `timeDeltas`).
 * `idle` is the time with nothing to run, `gc` the garbage collector and `program` what Node does that belongs to no function.
 * Returns `{ totalMs, busyMs, idleMs, gcMs, programMs, functions: [{ name, file, line, ms, percent }], files: [{ file, ms, percent }] }`
 * with the percent of the time that was BUSY (not idle), the most expensive first.
 */
function summarize(profile, { top = 12, topFiles = 8 } = {}) {
  const nodes = new Map((profile?.nodes ?? []).map((node) => [node.id, node]));
  const samples = profile?.samples ?? [];
  const deltas = profile?.timeDeltas ?? [];
  const selfUs = new Map();
  for (let i = 0; i < samples.length; i += 1) {
    // The time a sample covers is the gap to the next one (the last one gets the one before it).
    const us = Number(deltas[i + 1] ?? deltas[i] ?? 0);
    if (us > 0) selfUs.set(samples[i], (selfUs.get(samples[i]) ?? 0) + us);
  }
  let idle = 0; let gc = 0; let program = 0; let busy = 0;
  const byFunction = new Map();
  const byFile = new Map();
  for (const [id, us] of selfUs) {
    const node = nodes.get(id);
    const frame = node?.callFrame ?? {};
    const name = frame.functionName || '';
    if (name === '(idle)') { idle += us; continue; }
    if (name === '(garbage collector)') { gc += us; busy += us; continue; }
    if (name === '(program)' || name === '(root)') { program += us; busy += us; continue; }
    busy += us;
    const file = shortUrl(frame.url);
    const label = name || '(anonymous)';
    const key = `${label}|${file}|${frame.lineNumber ?? 0}`;
    const entry = byFunction.get(key) ?? { name: label, file, line: (frame.lineNumber ?? 0) + 1, us: 0 };
    entry.us += us;
    byFunction.set(key, entry);
    byFile.set(file, (byFile.get(file) ?? 0) + us);
  }
  const ms = (us) => Math.round(us / 100) / 10;
  const percent = (us) => (busy > 0 ? Math.round((us / busy) * 1000) / 10 : 0);
  return {
    totalMs: ms(idle + busy), busyMs: ms(busy), idleMs: ms(idle), gcMs: ms(gc), programMs: ms(program),
    functions: [...byFunction.values()].sort((a, b) => b.us - a.us).slice(0, top).map((entry) => ({ name: entry.name, file: entry.file, line: entry.line, ms: ms(entry.us), percent: percent(entry.us) })),
    files: [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, topFiles).map(([file, us]) => ({ file, ms: ms(us), percent: percent(us) })),
  };
}

const post = (session, method, params) => new Promise((resolve, reject) => {
  session.post(method, params, (error, result) => (error ? reject(error) : resolve(result)));
});

/** How many seconds to profile for what a person typed: a whole number from 3 to 30, 10 when it is empty or not a number. */
function parseSeconds(text) {
  const n = Number(String(text ?? '').trim());
  if (!String(text ?? '').trim() || !Number.isFinite(n)) return DEFAULT_SECONDS;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(n)));
}

/** Profiles this process for `seconds` and answers `summarize(...)`. It throws `busy` when another one is running. */
async function capture(seconds = DEFAULT_SECONDS, { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), top, topFiles } = {}) {
  if (running) throw new Error('busy');
  running = true;
  const session = new inspector.Session();
  session.connect();
  try {
    await post(session, 'Profiler.enable');
    await post(session, 'Profiler.setSamplingInterval', { interval: SAMPLING_US });
    await post(session, 'Profiler.start');
    await wait(seconds * 1000);
    const { profile } = await post(session, 'Profiler.stop');
    return summarize(profile, { top, topFiles });
  } finally {
    await post(session, 'Profiler.disable').catch(() => {});
    session.disconnect();
    running = false;
  }
}

/** The result as lines of text for the card of `!perf cpu`. */
function describe(result, seconds) {
  const busyShare = result.totalMs > 0 ? Math.round((result.busyMs / result.totalMs) * 100) : 0;
  const pad = (value, length) => String(value).slice(0, length).padEnd(length);
  const lines = [
    `**CPU profile** ${seconds} s · the bot was busy ${busyShare}% of the time (${result.busyMs} ms of ${result.totalMs} ms) · garbage collector ${result.gcMs} ms · Node itself ${result.programMs} ms`,
    '**Functions that used the most processor** (% of the busy time)',
    ...(result.functions.length ? result.functions.map((row) => `${pad(`${row.percent}%`, 6)} ${pad(`${row.ms} ms`, 9)} ${row.name} · ${row.file}:${row.line}`) : ['nothing ran']),
    '**By file**',
    ...(result.files.length ? result.files.map((row) => `${pad(`${row.percent}%`, 6)} ${pad(`${row.ms} ms`, 9)} ${row.file}`) : ['nothing ran']),
    '-# Self time of each function (what it called is counted for the called one). A quiet bot shows mostly idle: run it while the problem is happening.',
  ];
  return lines.join('\n');
}

const isRunning = () => running;

module.exports = { MIN_SECONDS, MAX_SECONDS, DEFAULT_SECONDS, summarize, shortUrl, parseSeconds, capture, describe, isRunning };
