// i18n-ignore-file: no text is shown to anyone here (it picks a message).
// More than one message for the welcome, the goodbye and the boost announcement. The first message of each is the one saved in `member_events_config`; the others are rows of
// `member_event_variants` (db/messageVariants.ts, at most 24, so 25 with the first). Each time the event happens `pickMessage` picks one of them at random and never the same
// one twice in a row. Written in TypeScript: `npm run build:ts` compiles it over src/utils/messageVariants.js, which is what the bot loads.
import { variantsOf, type Kind, type Message } from '../db/messageVariants';
export * from '../db/messageVariants';

const filled = (m: Message | null | undefined): m is Message => Boolean(m && ((m.message && m.message.trim()) || (m.template && m.template.trim())));

/**
 * Which of `count` messages to use: one at random, never `last` (when there is more than one). `random` is `Math.random` (given so it can be checked).
 */
export function chooseIndex(count: number, last: number | null, random: () => number = Math.random): number {
  if (count <= 1) return 0;
  if (last === null || last < 0 || last >= count) return Math.min(count - 1, Math.floor(random() * count));
  const pick = Math.min(count - 2, Math.floor(random() * (count - 1)));
  return pick >= last ? pick + 1 : pick;
}

const lastPick = new Map<string, number>(); // `${guild}:${kind}` -> the index used last
const REMEMBER = 5000;

/** The message to send now: the first one (`main`) and the others of the kind are the pool, and one is picked. With no other message, `main` is returned as it is. */
export async function pickMessage(guildId: string, kind: Kind, main: Message, random: () => number = Math.random): Promise<Message> {
  const extra = (await variantsOf(guildId, kind).catch(() => [])).filter(filled);
  if (!extra.length) return main;
  const pool: Message[] = [...(filled(main) ? [main] : []), ...extra.map((v) => ({ message: v.message, template: v.template }))];
  if (pool.length === 1) return pool[0];
  const key = `${guildId}:${kind}`;
  const index = chooseIndex(pool.length, lastPick.has(key) ? (lastPick.get(key) as number) : null, random);
  if (lastPick.size >= REMEMBER) lastPick.clear();
  lastPick.set(key, index);
  return pool[index];
}

