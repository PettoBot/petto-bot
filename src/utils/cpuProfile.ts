// i18n-ignore-file: Petto team operator tool, only the owner and the developers see it.
// A CPU profile of the running bot for a few seconds: which functions and which files use the processor. It only samples while it runs
// (the profiler of Node is off the rest of the time), only one runs at a time and it is refused when the bot is already struggling.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/cpuProfile.js, which is what the bot loads.
import inspector = require('node:inspector');

export const MIN_SECONDS = 3;
export const MAX_SECONDS = 30;
export const DEFAULT_SECONDS = 10;
const SAMPLING_US = 1000; // one sample per millisecond of the work that runs

let running = false;

/** One node of the profile of the inspector: an id and the function it stands for. */
interface ProfileNode {
  id: number;
  callFrame: { functionName?: string; url?: string; lineNumber?: number };
}

/** What the inspector gives back (`nodes`, the node of each sample in `samples` and the microseconds since the sample before in `timeDeltas`). */
export interface CpuProfile {
  nodes?: ProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

export interface FunctionRow { name: string; file: string; line: number; ms: number; percent: number }
export interface FileRow { file: string; ms: number; percent: number }
export interface CpuSummary {
  totalMs: number;
  busyMs: number;
  idleMs: number;
  gcMs: number;
  programMs: number;
  functions: FunctionRow[];
  files: FileRow[];
}

interface SummarizeOptions { top?: number; topFiles?: number }
interface CaptureOptions extends SummarizeOptions { wait?: (ms: number) => Promise<void> }

/** `file:///app/src/utils/x.js` or `/app/node_modules/pkg/y.js` as `src/utils/x.js` / `pkg/y.js`; what is not a file stays as it is. */
export function shortUrl(url?: string | null): string {
  if (!url) return '(native)';
  const path = String(url).replace(/^file:\/\//, '');
  const modules = path.lastIndexOf('node_modules/');
  if (modules >= 0) return path.slice(modules + 'node_modules/'.length);
  const src = path.lastIndexOf('/src/');
  if (src >= 0) return path.slice(src + 1);
  return path.split('/').slice(-2).join('/');
}

/**
 * The time each function used itself (not counting what it called), from a profile of the inspector (`nodes`, `samples`, `timeDeltas`).
 * `idle` is the time with nothing to run, `gc` the garbage collector and `program` what Node does that belongs to no function.
 * Returns the totals and the functions and files with the percent of the time that was BUSY (not idle), the most expensive first.
 */
export function summarize(profile: CpuProfile | null | undefined, { top = 12, topFiles = 8 }: SummarizeOptions = {}): CpuSummary {
  const nodes = new Map<number, ProfileNode>((profile?.nodes ?? []).map((node) => [node.id, node]));
  const samples = profile?.samples ?? [];
  const deltas = profile?.timeDeltas ?? [];
  const selfUs = new Map<number, number>();
  for (let i = 0; i < samples.length; i += 1) {
    // The time a sample covers is the gap to the next one (the last one gets the one before it).
    const us = Number(deltas[i + 1] ?? deltas[i] ?? 0);
    if (us > 0) selfUs.set(samples[i], (selfUs.get(samples[i]) ?? 0) + us);
  }
  let idle = 0;
  let gc = 0;
  let program = 0;
  let busy = 0;
  const byFunction = new Map<string, { name: string; file: string; line: number; us: number }>();
  const byFile = new Map<string, number>();
  for (const [id, us] of selfUs) {
    const frame = nodes.get(id)?.callFrame ?? {};
    const name = frame.functionName || '';
    if (name === '(idle)') { idle += us; continue; }
    busy += us;
    if (name === '(garbage collector)') { gc += us; continue; }
    if (name === '(program)' || name === '(root)') { program += us; continue; }
    const file = shortUrl(frame.url);
    const label = name || '(anonymous)';
    const key = `${label}|${file}|${frame.lineNumber ?? 0}`;
    const entry = byFunction.get(key) ?? { name: label, file, line: (frame.lineNumber ?? 0) + 1, us: 0 };
    entry.us += us;
    byFunction.set(key, entry);
    byFile.set(file, (byFile.get(file) ?? 0) + us);
  }
  const ms = (us: number): number => Math.round(us / 100) / 10;
  const percent = (us: number): number => (busy > 0 ? Math.round((us / busy) * 1000) / 10 : 0);
  return {
    totalMs: ms(idle + busy), busyMs: ms(busy), idleMs: ms(idle), gcMs: ms(gc), programMs: ms(program),
    functions: [...byFunction.values()].sort((a, b) => b.us - a.us).slice(0, top).map((entry) => ({ name: entry.name, file: entry.file, line: entry.line, ms: ms(entry.us), percent: percent(entry.us) })),
    files: [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, topFiles).map(([file, us]) => ({ file, ms: ms(us), percent: percent(us) })),
  };
}

function post<T = unknown>(session: inspector.Session, method: string, params?: object): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    session.post(method, params ?? {}, (error: Error | null, result?: object) => (error ? reject(error) : resolve(result as T)));
  });
}

/** How many seconds to profile for what a person typed: a whole number from 3 to 30, 10 when it is empty or not a number. */
export function parseSeconds(text?: unknown): number {
  const raw = String(text ?? '').trim();
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return DEFAULT_SECONDS;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(n)));
}

/** Profiles this process for `seconds` and answers `summarize(...)`. It throws `busy` when another one is running. */
export async function capture(seconds: number = DEFAULT_SECONDS, { wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }), top, topFiles }: CaptureOptions = {}): Promise<CpuSummary> {
  if (running) throw new Error('busy');
  running = true;
  const session = new inspector.Session();
  session.connect();
  try {
    await post(session, 'Profiler.enable');
    await post(session, 'Profiler.setSamplingInterval', { interval: SAMPLING_US });
    await post(session, 'Profiler.start');
    await wait(seconds * 1000);
    const { profile } = await post<{ profile: CpuProfile }>(session, 'Profiler.stop');
    return summarize(profile, { top, topFiles });
  } finally {
    await post(session, 'Profiler.disable').catch(() => {});
    session.disconnect();
    running = false;
  }
}

/** The result as lines of text for the card of `!perf cpu`. */
export function describe(result: CpuSummary, seconds: number): string {
  const busyShare = result.totalMs > 0 ? Math.round((result.busyMs / result.totalMs) * 100) : 0;
  const pad = (value: string | number, length: number): string => String(value).slice(0, length).padEnd(length);
  const lines = [
    `**CPU profile** ${seconds} s · the bot was busy ${busyShare}% of the time (${result.busyMs} ms of ${result.totalMs} ms) · garbage collector ${result.gcMs} ms · Node itself ${result.programMs} ms`, // i18n-ignore: team tool, English only
    '**Functions that used the most processor** (% of the busy time)', // i18n-ignore: team tool, English only
    ...(result.functions.length ? result.functions.map((row) => `${pad(`${row.percent}%`, 6)} ${pad(`${row.ms} ms`, 9)} ${row.name} · ${row.file}:${row.line}`) : ['nothing ran']), // i18n-ignore: team tool, English only
    '**By file**', // i18n-ignore: team tool, English only
    ...(result.files.length ? result.files.map((row) => `${pad(`${row.percent}%`, 6)} ${pad(`${row.ms} ms`, 9)} ${row.file}`) : ['nothing ran']), // i18n-ignore: team tool, English only
    '-# Self time of each function (what it called is counted for the called one). A quiet bot shows mostly idle: run it while the problem is happening.', // i18n-ignore: team tool, English only
  ];
  return lines.join('\n');
}

export const isRunning = (): boolean => running;
