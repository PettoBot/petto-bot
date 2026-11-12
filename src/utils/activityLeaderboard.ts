// The activity leaderboards: a card for the day, the week and the month (the ones the server chose) of the chat or of the voice channels, in a channel of the server, edited by Petto
// about every 5 minutes, and only when what they say changed.
// What is shown is read from `activity_members` (a count for each member and day, never what was said), so it follows what a server turned off in `!statsconfig` and
// who asked not to be counted (`!stats privacy`). Days, weeks (ISO, from Monday) and months are the ones of Petto, GMT-5 (Colombia).
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/activityLeaderboard.js, which is what the bot loads.
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { Client, ContainerBuilder, Guild, GuildBasedChannel } from 'discord.js';
import db = require('../db/activityLeaderboards');
import type { BoardRow, Kind, Period, TopRow } from '../db/activityLeaderboards';

export type { Period };
/** The order they are posted in, and so the order they read in: the longest first. */
export const PERIODS: readonly Period[] = db.PERIODS;
/** Places shown in a card: the first one on its own line (the most active) and the rest numbered. */
export const PLACES = 10;
/** How many members are asked for, so that the ones who left the server can be skipped and the card is still full. */
export const CANDIDATES = 30;

interface StatsRules { rulesOf(guildId: string): { enabled: boolean; members: boolean }; isOptedOut(userId: string): boolean }
interface Translate {
  t(lang: string, key: string, vars?: Record<string, unknown>): string;
  tn(lang: string, key: string, count: number, vars?: Record<string, unknown>): string;
  guildLanguage(guildId: string): Promise<string>;
}

// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const statsRules = require('../db/statsRules') as StatsRules;
const { botDay, OFFSET_MS } = require('./botTime') as { botDay: (date?: Date) => string; OFFSET_MS: number };
const { t, tn, guildLanguage } = require('../i18n') as Translate;
const { textCard } = require('./caseCard') as { textCard: (text: string, color?: number | null) => ContainerBuilder };
const { EMOJI } = require('./emojis') as { EMOJI: Record<string, string> };
const icons = require('../music/icons') as Record<string, string>;
const logger = require('./logger') as { warn: (message: string) => void };

const DAY_MS = 86_400_000;
/** A card that says the same as the last time is not edited again, except once in a while: that is how a message that someone deleted is found and written again. */
const FORCE_EDIT_MS = 55 * 60_000;
const lastWritten = new Map<string, { text: string; at: number }>();
const writtenKey = (row: BoardRow, period: Period): string => `${row.guild_id}:${row.kind}:${period}`;

// ---- Periods -------------------------------------------------------------------------------------------------------------------

/** `startDay` is the first day (`YYYY-MM-DD`, GMT-5) that counts in the period, `resetAt` the moment the next one begins. */
export interface PeriodWindow { startDay: string; resetAt: Date }

/** The period of `at` for a kind of card: today, this ISO week (Monday to Sunday) or this month, and when it ends. All in GMT-5. */
export function periodWindow(period: Period, at: Date = new Date()): PeriodWindow {
  const clock = new Date(at.getTime() + OFFSET_MS); // its UTC fields are the clock of Colombia
  const today = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
  let start = today;
  let end = today + DAY_MS;
  if (period === 'weekly') {
    const weekday = new Date(today).getUTCDay() || 7; // Monday is 1 and Sunday is 7
    start = today - (weekday - 1) * DAY_MS;
    end = start + 7 * DAY_MS;
  } else if (period === 'monthly') {
    start = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), 1);
    end = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() + 1, 1);
  }
  return { startDay: new Date(start).toISOString().slice(0, 10), resetAt: new Date(end - OFFSET_MS) };
}

// ---- The card ------------------------------------------------------------------------------------------------------------------

/** A member of the top, ready to show: the username (it has no characters that need escaping) and the amount (messages, or seconds of voice). */
export interface Entry { username: string; amount: number }

const rankEmoji = (place: number): string => EMOJI[`BOARD_RANK_${String(place).padStart(2, '0')}`] ?? `${place}.`;
const amountText = (lang: string, kind: Kind, amount: number): string => (kind === 'voice'
  ? tn(lang, 'leaderboards.unit.minutes', Math.floor(amount / 60))
  : tn(lang, 'leaderboards.unit.messages', amount));

/** The words of one card: the title, the most active member, the next places, when it starts again and how often it is updated. */
export function boardText(lang: string, kind: Kind, period: Period, entries: Entry[], resetAt: Date): string {
  const title = `**${t(lang, `leaderboards.title.${kind}`, { period: t(lang, `leaderboards.period.${period}`) })}**`;
  const lines: string[] = [title, ''];
  if (!entries.length) {
    lines.push(t(lang, 'leaderboards.empty'));
  } else {
    const [first, ...rest] = entries.slice(0, PLACES);
    lines.push(`${EMOJI.BOARD_TOP} **${t(lang, `leaderboards.top.${kind}`)}** \`${first.username}\` ${EMOJI.BOARD_ARROW} **${amountText(lang, kind, first.amount)}**`);
    if (rest.length) lines.push('');
    rest.forEach((entry, index) => lines.push(`${rankEmoji(index + 2)} \`${entry.username}\` ${EMOJI.BOARD_ARROW} **${amountText(lang, kind, entry.amount)}**`));
  }
  lines.push('', `${icons.CLOCK} **${t(lang, 'leaderboards.resets', { when: `<t:${Math.floor(resetAt.getTime() / 1000)}:R>` })}**`, `-# ${t(lang, 'leaderboards.footer')}`);
  return lines.join('\n');
}

// ---- Who is in the top ---------------------------------------------------------------------------------------------------------

/** A member who may be in a top: who they are and what they did in the period. */
export interface TopMember extends Entry { userId: string }

/**
 * The top of the period with the usernames: members who are no longer in the server, bots and people who asked not to be counted are left out.
 * The role of the most active member of the week is given from the same list, so the card and the role always name the same person.
 */
export async function topMembers(guild: Guild, rows: TopRow[], limit: number = PLACES): Promise<TopMember[]> {
  const wanted = rows.filter((row) => !statsRules.isOptedOut(row.user_id));
  const missing = wanted.map((row) => row.user_id).filter((id) => !guild.members.cache.has(id));
  if (missing.length) await guild.members.fetch({ user: missing.slice(0, 100) }).catch(() => null);
  const members: TopMember[] = [];
  for (const row of wanted) {
    const member = guild.members.cache.get(row.user_id);
    if (!member || member.user.bot) continue;
    members.push({ userId: row.user_id, username: member.user.username, amount: row.amount });
    if (members.length >= limit) break;
  }
  return members;
}

const entriesOf = async (guild: Guild, rows: TopRow[]): Promise<Entry[]> => (await topMembers(guild, rows)).map(({ username, amount }) => ({ username, amount }));

// ---- Writing the three messages -------------------------------------------------------------------------------------------------

const ERROR_CODES = { unknownChannel: 10003, unknownMessage: 10008, missingAccess: 50001, missingPermissions: 50013 } as const;
const codeOf = (error: unknown): number | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
};

/** The short reason saved in the board when it cannot be written; the command and the dashboard say it in words. */
export type Reason = 'statsOff' | 'membersOff' | 'channel' | 'permissions' | 'error';

/** `wrote` is true when a message was edited, posted or deleted at Discord: a board with nothing new costs the database only. */
export interface RefreshResult { ok: boolean; reason?: Reason; wrote?: boolean }

const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];

/** Can Petto write in this channel? The channel, or a reason. */
export function writableChannel(guild: Guild, channel: GuildBasedChannel | null): { channel: Extract<GuildBasedChannel, { messages: unknown }> } | { reason: Reason } {
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return { reason: 'channel' };
  const me = guild.members.me;
  if (!me || !NEEDED.every((flag) => channel.permissionsFor(me).has(flag))) return { reason: 'permissions' };
  return { channel: channel as Extract<GuildBasedChannel, { messages: unknown }> };
}

/** The reason a server cannot have boards at all: statistics turned off, or kept without members. */
export function statsReason(guildId: string): 'statsOff' | 'membersOff' | null {
  const rules = statsRules.rulesOf(guildId);
  if (!rules.enabled) return 'statsOff';
  if (!rules.members) return 'membersOff';
  return null;
}

/**
 * Writes the cards of a board (the periods the server chose): edits the messages it has, or posts them all again in order when one is missing (deleted by someone) or a
 * period was added, and remembers them. A card that says the same as when it was last written is not edited again (about once an hour it is, to find a deleted one), so a
 * quiet server costs nothing at Discord. A board that cannot be written keeps the reason in the database. Never throws for something that is the server's doing.
 */
export async function refreshBoard(client: Client, row: BoardRow, { now = new Date(), force = false }: { now?: Date; force?: boolean } = {}): Promise<RefreshResult> {
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) return { ok: false, reason: 'error' }; // not reachable now: nothing is said, it is looked at again
  const fail = async (reason: Reason): Promise<RefreshResult> => { await db.markError(row.guild_id, row.kind, reason); return { ok: false, reason }; };

  const blocked = statsReason(guild.id);
  if (blocked) return fail(blocked);
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  const writable = writableChannel(guild, channel);
  if ('reason' in writable) return fail(writable.reason);
  const lang = await guildLanguage(guild.id);

  // Only the periods the server chose are read and written; the others have no message.
  const chosen = PERIODS.filter((period) => db.cleanPeriods(row.periods).includes(period));
  const texts = new Map<Period, string>();
  const payloads = new Map<Period, { components: ContainerBuilder[]; flags: MessageFlags.IsComponentsV2; allowedMentions: { parse: [] } }>();
  for (const period of chosen) {
    const window = periodWindow(period, now);
    const entries = await entriesOf(guild, await db.readTop(guild.id, row.kind, window.startDay, CANDIDATES));
    const text = boardText(lang, row.kind, period, entries, window.resetAt);
    texts.set(period, text);
    payloads.set(period, { components: [textCard(text)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  }

  const known: Record<Period, string | null> = { daily: row.daily_message_id, weekly: row.weekly_message_id, monthly: row.monthly_message_id };
  const saved: Record<Period, string | null> = { ...known };
  let wrote = false;
  try {
    // A period that was taken away loses its message; the others stay where they are.
    for (const period of PERIODS) {
      if (chosen.includes(period) || !known[period]) continue;
      await writable.channel.messages.delete(known[period] as string).catch(() => null);
      wrote = true;
      saved[period] = null;
      lastWritten.delete(writtenKey(row, period));
    }
    // A period that was added has no message yet: they are all written again so they stay in order.
    let repost = chosen.some((period) => !known[period]);
    if (!repost) {
      for (const period of chosen) {
        const before = lastWritten.get(writtenKey(row, period));
        if (!force && before && before.text === texts.get(period) && now.getTime() - before.at < FORCE_EDIT_MS) continue; // nothing changed (a command writes them anyway)
        try {
          await writable.channel.messages.edit(known[period] as string, payloads.get(period)!);
          wrote = true;
          lastWritten.set(writtenKey(row, period), { text: texts.get(period) as string, at: now.getTime() });
        } catch (error) {
          if (codeOf(error) !== ERROR_CODES.unknownMessage) throw error;
          repost = true; // someone deleted one: all of them are written again so they stay in order
          break;
        }
      }
    }
    if (repost) {
      wrote = true;
      for (const period of chosen) {
        if (known[period]) await writable.channel.messages.delete(known[period] as string).catch(() => null);
      }
      for (const period of chosen) {
        saved[period] = (await writable.channel.send(payloads.get(period)!)).id;
        lastWritten.set(writtenKey(row, period), { text: texts.get(period) as string, at: now.getTime() });
      }
    }
  } catch (error) {
    const code = codeOf(error);
    if (code === ERROR_CODES.unknownChannel) return fail('channel');
    if (code === ERROR_CODES.missingAccess || code === ERROR_CODES.missingPermissions) return fail('permissions');
    logger.warn(`Activity leaderboard (${row.kind}) in guild ${row.guild_id} could not be written: ${(error as Error)?.message}`);
    return fail('error');
  }
  await db.saveMessages(row.guild_id, row.kind, { daily: saved.daily, weekly: saved.weekly, monthly: saved.monthly });
  await db.markRefreshed(row.guild_id, row.kind);
  return { ok: true, wrote };
}

/** Deletes the messages of a board that was taken away (best effort: they may be gone already or Petto may not see the channel). */
export async function deleteBoardMessages(client: Client, row: BoardRow): Promise<void> {
  for (const period of PERIODS) lastWritten.delete(writtenKey(row, period));
  const guild = client.guilds.cache.get(row.guild_id);
  const channel = guild ? await guild.channels.fetch(row.channel_id).catch(() => null) : null;
  if (!channel || !('messages' in channel)) return;
  for (const id of [row.daily_message_id, row.weekly_message_id, row.monthly_message_id]) {
    if (id) await channel.messages.delete(id).catch(() => null);
  }
}

/**
 * Looks at the boards that are due, one server after another. After a board that wrote something at Discord there is a pause, so a few hundred servers never send a burst of
 * edits; a board with nothing new needs none. A round stops after `budgetMs` and the ones left are the first due at the next look.
 */
export async function runDueBoards(client: Client, { pauseMs = 1500, budgetMs = 45_000, now = () => Date.now(), sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }) }: { pauseMs?: number; budgetMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<number> {
  const due = await db.listDue(60);
  const started = now();
  let looked = 0;
  for (const row of due) {
    if (now() - started > budgetMs) break;
    looked += 1;
    let wrote = true;
    try {
      wrote = Boolean((await refreshBoard(client, row)).wrote);
    } catch (error) {
      logger.warn(`Activity leaderboard (${row.kind}) in guild ${row.guild_id} failed: ${(error as Error)?.message}`);
    }
    if (wrote) await sleep(pauseMs);
  }
  return looked;
}
