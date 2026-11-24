// i18n-ignore-file: the missions are codes and numbers; the website and the command write the words.
// The missions: what a person does (messages, minutes in voice) in a day or a week, in every server where Petto counts them, and the ceramos each one pays once for each period.
// Written in TypeScript: `npm run build:ts` compiles it over utils/missions.js.
export type Period = 'day' | 'week';
export type Kind = 'messages' | 'voice';
export interface Mission { id: string; period: Period; kind: Kind; /** Messages, or minutes in voice. */ target: number; reward: number }

export const MISSIONS: Mission[] = [
  { id: 'messages-day-25', period: 'day', kind: 'messages', target: 25, reward: 3 },
  { id: 'messages-day-100', period: 'day', kind: 'messages', target: 100, reward: 6 },
  { id: 'voice-day-30', period: 'day', kind: 'voice', target: 30, reward: 4 },
  { id: 'voice-day-120', period: 'day', kind: 'voice', target: 120, reward: 8 },
  { id: 'messages-week-500', period: 'week', kind: 'messages', target: 500, reward: 20 },
  { id: 'voice-week-600', period: 'week', kind: 'voice', target: 600, reward: 25 },
];

export const missionById = (id: unknown): Mission | null => MISSIONS.find((mission) => mission.id === id) ?? null;

const dayOf = (when: Date): string => when.toISOString().slice(0, 10);

/** The first day of the period (UTC): the day itself, or the Monday of the week. */
export function startOf(period: Period, now: Date): string {
  if (period === 'day') return dayOf(now);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return dayOf(monday);
}

/** When the period ends (the start of the next day, or of the next Monday), UTC. */
export function endsAt(period: Period, now: Date): Date {
  const start = new Date(`${startOf(period, now)}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + (period === 'day' ? 1 : 7));
  return start;
}
