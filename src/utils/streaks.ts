// i18n-ignore-file: numbers and days only; the website and the command write the words.
// Streaks: days in a row with activity in a server. A day is active when the person sent at least the messages (or spent at least the minutes in voice) the server asks. A plan gives
// freezes: each one covers a missed day inside a streak (a streak never starts or ends with a freeze). Pure functions, so the checks can run them alone.
// Written in TypeScript: `npm run build:ts` compiles it over utils/streaks.js.
export interface DayRow { day: string; messages: number; voiceSeconds: number }
export type StreakMode = 'messages' | 'voice' | 'any' | 'both';
export interface StreakRules { minMessages: number; minVoiceMinutes: number; mode?: StreakMode }
export const DEFAULT_RULES: StreakRules = { minMessages: 1, minVoiceMinutes: 0, mode: 'any' };

const DAY_MS = 86_400_000;
const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
export const dayOf = (when: Date): string => when.toISOString().slice(0, 10);

/** The moment that decides which day is "today" for a streak: `graceMinutes` before now, so the day that just ended still counts for that long. */
export const graceNow = (now: Date, graceMinutes: number): Date => new Date(now.getTime() - Math.max(0, Number(graceMinutes) || 0) * 60_000);

/** The active days (sorted, with no repeats). With a minimum of 0 for both, a day is active when there was any message or any voice. */
export function activeDays(rows: DayRow[], rules: StreakRules): string[] {
  const out = new Set<string>();
  const mode = rules.mode ?? 'any';
  for (const row of rows) {
    // One thing only (messages or voice), both on the same day, or either of them (the default). A minimum of 0 counts as 1.
    const needMessages = Math.max(1, rules.minMessages);
    const needVoice = Math.max(1, rules.minVoiceMinutes) * 60;
    if (mode === 'messages') { if (row.messages >= needMessages) out.add(row.day); continue; }
    if (mode === 'voice') { if (row.voiceSeconds >= needVoice) out.add(row.day); continue; }
    if (mode === 'both') { if (row.messages >= needMessages && row.voiceSeconds >= needVoice) out.add(row.day); continue; }
    const byMessages = rules.minMessages > 0 && row.messages >= rules.minMessages;
    const byVoice = rules.minVoiceMinutes > 0 && row.voiceSeconds >= rules.minVoiceMinutes * 60;
    const any = rules.minMessages === 0 && rules.minVoiceMinutes === 0 && (row.messages > 0 || row.voiceSeconds > 0);
    if (byMessages || byVoice || any) out.add(row.day);
  }
  return [...out].sort();
}

export interface Streak { current: number; best: number; freezesUsed: number; activeToday: boolean }

/** The current streak (alive while today or yesterday is covered), the best one ever and how many freezes the current one used. */
export function compute(days: string[], today: string, freezes: number): Streak {
  const nums = [...new Set(days.map(dayNumber))].sort((a, b) => a - b);
  if (!nums.length) return { current: 0, best: 0, freezesUsed: 0, activeToday: false };
  // Streaks from the oldest day: a gap of missed days is bridged while the freezes of that streak last.
  const streaks: { count: number; used: number; last: number }[] = [];
  let run = { count: 1, used: 0, last: nums[0] };
  for (const n of nums.slice(1)) {
    const missed = n - run.last - 1;
    if (missed === 0) run = { count: run.count + 1, used: run.used, last: n };
    else if (run.used + missed <= freezes) run = { count: run.count + 1, used: run.used + missed, last: n };
    else { streaks.push(run); run = { count: 1, used: 0, last: n }; }
  }
  streaks.push(run);
  const best = Math.max(...streaks.map((s) => s.count));
  const todayNumber = dayNumber(today);
  const last = streaks[streaks.length - 1];
  // Alive: the last active day is today or yesterday, or the missed days since then can still be frozen.
  const sinceLast = todayNumber - last.last;
  const pending = Math.max(0, sinceLast - 1);
  const alive = sinceLast <= 1 || last.used + pending <= freezes;
  const activeToday = nums[nums.length - 1] === todayNumber;
  return { current: alive ? last.count : 0, best, freezesUsed: alive ? last.used + (sinceLast > 1 ? pending : 0) : 0, activeToday };
}
