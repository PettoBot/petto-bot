// `/levels manage sync`: puts the leveling of a server in order again, for what was chosen. Never announces anything and never takes a role from anybody.
//   roles        gives each member the reward roles of the levels of the messages that they have already earned
//   voice-roles  the same for the levels of the voice
//   levels       calculates the level of the messages and of the voice again from the XP with the curve and the maximum level of today (after changing them,
//                the levels that were saved are old)
//   messages     raises the counter of messages of each member to what the activity statistics (`!stats`) say, when it says more
//   all          everything above, levels first so that the roles follow the new levels
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/levelSync.js, which is what the bot loads.
import type { Guild, GuildMember } from 'discord.js';
import { statsReason } from './activityLeaderboard';

export type SyncKind = 'roles' | 'voice-roles' | 'levels' | 'messages';
export type SyncType = SyncKind | 'all';
/** The values of the option `type`, in the order they are offered. */
export const SYNC_TYPES: readonly SyncType[] = ['roles', 'voice-roles', 'levels', 'messages', 'all'];
const ALL_KINDS: readonly SyncKind[] = ['levels', 'roles', 'voice-roles', 'messages'];

/** The kinds a `type` stands for, in the order they are done (levels first, so the roles are given for the new levels); a word that is not one is `roles`, what the command did before. */
export function kindsOf(type: unknown): SyncKind[] {
  const word = String(type ?? 'roles').toLowerCase();
  if (word === 'all') return [...ALL_KINDS];
  const kind = ALL_KINDS.find((each) => each === word);
  return [kind ?? 'roles'];
}

/** Members whose roles are looked at (Petto asks Discord for each of them), and rows whose levels are calculated. A bigger server runs it again. */
export const MEMBER_LIMIT = 10000;
export const ROW_LIMIT = 20000;
const PAGE = 100;

/** What a sync did. `skipped` is a reason a kind was not done at all. */
export interface SyncResult {
  kinds: SyncKind[];
  checked: number;
  roles: number;
  voiceRoles: number;
  levels: number;
  messages: number;
  limited: boolean;
  skipped: Partial<Record<SyncKind, 'statsOff' | 'membersOff'>>;
}

interface Row { user_id: string; xp?: number | string; level?: number; voice_xp?: number | string; voice_level?: number; messages?: number | string }
interface UsersDb {
  listWithLevels(guildId: string, options: { offset: number; limit: number }): Promise<Row[]>;
  listForSync(guildId: string, options: { offset: number; limit: number }): Promise<Row[]>;
  setLevel(guildId: string, userId: string, level: number): Promise<unknown>;
  setVoiceLevel(guildId: string, userId: string, level: number): Promise<unknown>;
  raiseMessagesFromStats(guildId: string): Promise<number>;
}
type Config = Record<string, unknown>;

// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const usersDb = require('../db/levelUsers') as UsersDb;
const { levelForXp } = require('./levelCurve') as { levelForXp: (xp: number, config: Config) => number };
const { getVoiceConfig } = require('./levelSource') as { getVoiceConfig: (config: Config) => Config };
const actions = require('./levelActions') as { checkRewards: (guild: Guild, member: GuildMember, level: number, config: Config, source: 'text' | 'voice') => Promise<unknown> };
const logger = require('./logger') as { warn: (message: string) => void };

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The level that an amount of XP is worth for a kind (`config` is the one of the kind), never above its maximum. */
export function levelOf(xp: unknown, config: Config): number {
  const amount = Math.max(0, Number(xp) || 0);
  return Math.min(levelForXp(amount, config), Number(config.max_level ?? 1000));
}

/**
 * Does what was asked for the whole server. The members are read in pages by user id; the Discord work (roles) stops after `MEMBER_LIMIT` members, the database work
 * after `ROW_LIMIT` rows, and `limited` says so. `pause` is the wait after some roles were given, so a server with many does not hit the limits of Discord.
 */
export async function runSync(guild: Guild, config: Config, kinds: readonly SyncKind[], { pause = wait }: { pause?: (ms: number) => Promise<void> } = {}): Promise<SyncResult> {
  const result: SyncResult = { kinds: [...kinds], checked: 0, roles: 0, voiceRoles: 0, levels: 0, messages: 0, limited: false, skipped: {} };
  const wants = (kind: SyncKind): boolean => kinds.includes(kind);
  const voiceConfig = getVoiceConfig(config);

  // The counter of messages is one statement of the database: it needs no member and no page.
  if (wants('messages')) {
    const blocked = statsReason(guild.id);
    if (blocked) result.skipped.messages = blocked;
    else result.messages = await usersDb.raiseMessagesFromStats(guild.id);
  }

  const needsRows = wants('levels') || wants('roles') || wants('voice-roles');
  if (!needsRows) return result;
  const needsMembers = wants('roles') || wants('voice-roles');
  const limit = needsMembers ? MEMBER_LIMIT : ROW_LIMIT;
  // Only the members with a level can be given a role; to calculate levels, everybody with a row is needed.
  const list = wants('levels') ? usersDb.listForSync : usersDb.listWithLevels;
  let sinceBreak = 0;
  for (let offset = 0; result.checked < limit; offset += PAGE) {
    const page = await list(guild.id, { offset, limit: PAGE });
    if (!page.length) break;
    const members = needsMembers ? await guild.members.fetch({ user: page.map((row) => row.user_id) }).catch(() => null) : null;
    for (const row of page) {
      const member = members?.get(row.user_id) ?? null;
      if (needsMembers && !member) continue; // who left has nobody to give a role to
      let level = Number(row.level ?? 0);
      let voiceLevel = Number(row.voice_level ?? 0);
      if (wants('levels')) {
        const newLevel = levelOf(row.xp, config);
        const newVoiceLevel = levelOf(row.voice_xp, voiceConfig);
        let changed = false;
        if (newLevel !== level) { await usersDb.setLevel(guild.id, row.user_id, newLevel); level = newLevel; changed = true; }
        if (newVoiceLevel !== voiceLevel) { await usersDb.setVoiceLevel(guild.id, row.user_id, newVoiceLevel); voiceLevel = newVoiceLevel; changed = true; }
        if (changed) result.levels += 1;
      }
      result.checked += 1;
      if (member && wants('roles') && level > 0 && await actions.checkRewards(guild, member, level, config, 'text').catch((error: Error) => { logger.warn(`Sync: roles of ${row.user_id} in ${guild.id}: ${error.message}`); return null; })) { result.roles += 1; sinceBreak += 1; }
      if (member && wants('voice-roles') && voiceLevel > 0 && await actions.checkRewards(guild, member, voiceLevel, voiceConfig, 'voice').catch((error: Error) => { logger.warn(`Sync: voice roles of ${row.user_id} in ${guild.id}: ${error.message}`); return null; })) { result.voiceRoles += 1; sinceBreak += 1; }
      if (sinceBreak >= 5) { sinceBreak = 0; await pause(400); }
    }
    if (page.length < PAGE) break;
  }
  result.limited = result.checked >= limit;
  return result;
}
