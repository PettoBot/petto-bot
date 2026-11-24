// i18n-ignore-file: the answers are codes and numbers; the website and the command write the words.
// The missions of a person: the list with the progress and what was claimed, and claiming. Kept apart from the API of the pages so the checks can run it alone.
// Written in TypeScript: `npm run build:ts` compiles it over utils/missionActions.js.
const missions = require('./missions') as typeof import('./missions');
const db = require('../db/missions') as typeof import('../db/missions');
const walletDb = require('../db/ceramos') as typeof import('../db/ceramos');

async function progressOf(userId: string, now: Date) {
  const today = missions.startOf('day', now);
  const weekStart = missions.startOf('week', now);
  const [day, week] = await Promise.all([db.activityBetween(userId, today, today), db.activityBetween(userId, weekStart, today)]);
  return { day, week, keys: { day: today, week: weekStart } };
}

const valueOf = (mission: import('./missions').Mission, activity: { messages: number; voiceSeconds: number }): number => (mission.kind === 'messages' ? activity.messages : Math.floor(activity.voiceSeconds / 60));

export async function list(userId: string, now: Date = new Date()) {
  const progress = await progressOf(userId, now);
  const done = await db.claimed(userId, [progress.keys.day, progress.keys.week]);
  return {
    ok: true as const,
    resets: { day: missions.endsAt('day', now).toISOString(), week: missions.endsAt('week', now).toISOString() },
    missions: missions.MISSIONS.map((mission) => {
      const key = progress.keys[mission.period];
      const value = valueOf(mission, progress[mission.period]);
      return { id: mission.id, period: mission.period, kind: mission.kind, target: mission.target, reward: mission.reward, progress: Math.min(value, mission.target), complete: value >= mission.target, claimed: done.has(`${mission.id}|${key}`) };
    }),
  };
}

/** Claims one mission (`id`) or every finished one (no id). Only what is finished and not claimed this period pays. */
export async function claim(userId: string, id: unknown, now: Date = new Date()) {
  const wanted = id === undefined || id === null ? missions.MISSIONS : [missions.missionById(id)].filter((mission): mission is import('./missions').Mission => mission !== null);
  if (!wanted.length) return { ok: false as const, error: 'unknown_mission' as const };
  const progress = await progressOf(userId, now);
  const paid: { id: string; reward: number }[] = [];
  let balance: number | null = null;
  for (const mission of wanted) {
    if (valueOf(mission, progress[mission.period]) < mission.target) continue;
    const done = await db.claimOnce(userId, mission.id, progress.keys[mission.period], mission.reward);
    if (done.applied) { paid.push({ id: mission.id, reward: mission.reward }); balance = done.balance; }
  }
  if (!paid.length) return { ok: false as const, error: (id === undefined || id === null ? 'nothing_to_claim' : 'not_ready') as 'nothing_to_claim' | 'not_ready' };
  return { ok: true as const, paid, total: paid.reduce((sum, mission) => sum + mission.reward, 0), balance: balance ?? (await walletDb.getWallet(userId)).balance };
}
