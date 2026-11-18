// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The moderation rules of a server (tables `mod_rule_settings`, `mod_lists`, `mod_rulesets`, `mod_rules`, `mod_join_gate`, `mod_rule_violations`, `mod_rule_heat` and
// `mod_rule_logs` of schema.sql). The dashboard writes them (it is the only place where rules are made); the bot reads them for every message, so they are kept for a few
// seconds and forgotten when the dashboard changes them. The counters of violations and the heat are written here and not in memory, so a restart of the bot does not
// give anybody a clean record.
// Written in TypeScript: `npm run build:ts` compiles it over src/db/modRules.js, which is what the bot loads.
import type { Condition, Effect, JoinGate, Lists, Trigger } from '../utils/modRules';
import { DEFAULT_GATE, cleanJoinGate, decayedHeat } from '../utils/modRules';

interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };
const { createExpiringCache } = require('../utils/expiringCache') as { createExpiringCache: <T>(ttl: number, options: { invalidateOn: string[] }) => { get(key: string, loader: () => Promise<T>): Promise<T>; delete(key: string): void } };

export interface Settings { enabled: boolean; ignore_staff: boolean; ignore_bots: boolean; log_channel_id: string | null; heat_decay: number; quarantine_role_id: string | null }
export interface CompiledRule {
  id: number; name: string; dry_run: boolean; trigger_mode: string; triggers: Trigger[]; conditions: Condition[]; effects: Effect[];
  threshold_count: number; threshold_minutes: number; stop: boolean;
}
export interface CompiledRuleset { id: number; name: string; conditions: Condition[]; rules: CompiledRule[] }
export interface Compiled { settings: Settings; rulesets: CompiledRuleset[]; lists: Lists; gate: JoinGate; gateWords: string[] }

const DEFAULTS: Settings = { enabled: true, ignore_staff: true, ignore_bots: true, log_channel_id: null, heat_decay: 10, quarantine_role_id: null };
const TABLES = ['mod_rule_settings', 'mod_lists', 'mod_rulesets', 'mod_rules', 'mod_join_gate'];
const cache = createExpiringCache<Compiled>(15_000, { invalidateOn: TABLES });
const arr = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Everything a message or a join needs: the settings, the rulesets with their rules (only what is on), the lists and the join gate. A server with no rules costs one cached read. */
export function load(guildId: string): Promise<Compiled> {
  return cache.get(String(guildId), async () => {
    const pool = getPrimaryPool();
    const [settings, sets, rules, lists, gate] = await Promise.all([
      pool.query('select enabled, ignore_staff, ignore_bots, log_channel_id, heat_decay, quarantine_role_id from mod_rule_settings where guild_id = $1', [guildId]),
      pool.query('select id, name, conditions from mod_rulesets where guild_id = $1 and enabled order by position, id', [guildId]),
      pool.query('select id, ruleset_id, name, dry_run, trigger_mode, triggers, conditions, effects, threshold_count, threshold_minutes, stop from mod_rules where guild_id = $1 and enabled order by position, id', [guildId]),
      pool.query('select id, kind, items from mod_lists where guild_id = $1', [guildId]),
      pool.query('select * from mod_join_gate where guild_id = $1', [guildId]),
    ]);
    const words = new Map<number, string[]>();
    const domains = new Map<number, string[]>();
    for (const row of lists.rows) (row.kind === 'domains' ? domains : words).set(Number(row.id), arr<string>(row.items));
    const rulesets: CompiledRuleset[] = sets.rows.map((row) => ({ id: Number(row.id), name: String(row.name), conditions: arr<Condition>(row.conditions), rules: [] }));
    const byId = new Map(rulesets.map((set) => [set.id, set]));
    for (const row of rules.rows) {
      byId.get(Number(row.ruleset_id))?.rules.push({
        id: Number(row.id), name: String(row.name), dry_run: row.dry_run === true, trigger_mode: String(row.trigger_mode), triggers: arr<Trigger>(row.triggers), conditions: arr<Condition>(row.conditions), effects: arr<Effect>(row.effects),
        threshold_count: Number(row.threshold_count) || 1, threshold_minutes: Number(row.threshold_minutes) || 10, stop: row.stop !== false,
      });
    }
    const first = settings.rows[0];
    const gateRow = gate.rows[0];
    const gateConfig = gateRow ? cleanJoinGate(gateRow) : { ...DEFAULT_GATE };
    const gateWords = gateConfig.username_list_id !== null ? [...(words.get(gateConfig.username_list_id) ?? []), ...gateConfig.username_words] : gateConfig.username_words;
    return {
      settings: first ? {
        enabled: first.enabled !== false, ignore_staff: first.ignore_staff !== false, ignore_bots: first.ignore_bots !== false, log_channel_id: (first.log_channel_id as string | null) ?? null,
        heat_decay: Number(first.heat_decay ?? 10), quarantine_role_id: (first.quarantine_role_id as string | null) ?? null,
      } : { ...DEFAULTS },
      rulesets: rulesets.filter((set) => set.rules.length), lists: { words, domains }, gate: gateConfig, gateWords,
    };
  });
}

export function forget(guildId: string): void { cache.delete(String(guildId)); }

/** Counts a hit without waiting for it: a missed count is not worth slowing a message down. */
export function countHit(guildId: string, ruleId: number): void {
  getPrimaryPool().query('update mod_rules set hits = hits + 1 where guild_id = $1 and id = $2', [guildId, ruleId]).then(() => undefined, () => undefined);
}

// ---- Violations: a named counter of what a member did, with the time of each ------------------------------------------------------------------------

const VIOLATIONS_KEPT_DAYS = 31;
let violationWrites = 0;

/** Writes one violation of `name` for the member and returns how many of that name there are in the last `minutes` (this one included). */
export async function addViolation(guildId: string, userId: string, name: string, minutes: number): Promise<number> {
  const pool = getPrimaryPool();
  await pool.query('insert into mod_rule_violations (guild_id, user_id, name) values ($1, $2, $3)', [guildId, userId, name]);
  violationWrites += 1;
  if (violationWrites % 200 === 0) pool.query(`delete from mod_rule_violations where at < now() - make_interval(days => ${VIOLATIONS_KEPT_DAYS})`).then(() => undefined, () => undefined);
  return countViolations(guildId, userId, name, minutes);
}

export async function countViolations(guildId: string, userId: string, name: string, minutes: number): Promise<number> {
  const { rows } = await getPrimaryPool().query('select count(*)::int as n from mod_rule_violations where guild_id = $1 and user_id = $2 and name = $3 and at > now() - make_interval(mins => $4::int)', [guildId, userId, name, minutes]);
  return Number(rows[0]?.n ?? 0);
}

export async function resetViolations(guildId: string, userId: string, name: string): Promise<void> {
  await getPrimaryPool().query('delete from mod_rule_violations where guild_id = $1 and user_id = $2 and name = $3', [guildId, userId, name]);
}

// ---- Heat: a number that rises with what a member does and falls by itself ------------------------------------------------------------------------------

/** The heat of the member now (what was saved, minus `decayPerMinute` for each minute since). */
export async function getHeat(guildId: string, userId: string, decayPerMinute: number): Promise<number> {
  const { rows } = await getPrimaryPool().query('select heat, updated_at from mod_rule_heat where guild_id = $1 and user_id = $2', [guildId, userId]);
  const row = rows[0];
  return row ? decayedHeat(Number(row.heat), new Date(String(row.updated_at)).getTime(), Date.now(), decayPerMinute) : 0;
}

/** Adds `amount` to the heat of the member (after letting it fall) and returns the new heat. */
export async function addHeat(guildId: string, userId: string, amount: number, decayPerMinute: number): Promise<number> {
  const next = (await getHeat(guildId, userId, decayPerMinute)) + amount;
  await getPrimaryPool().query(
    'insert into mod_rule_heat (guild_id, user_id, heat, updated_at) values ($1, $2, $3, now()) on conflict (guild_id, user_id) do update set heat = excluded.heat, updated_at = now()',
    [guildId, userId, next]);
  return next;
}

export async function resetHeat(guildId: string, userId: string): Promise<void> {
  await getPrimaryPool().query('delete from mod_rule_heat where guild_id = $1 and user_id = $2', [guildId, userId]);
}

const KEPT_LOGS = 500;
let written = 0;
/** What a rule did: the rule, the member, the channel, what matched and the effects. Never the text of the message. Only the last 500 are kept for each server. */
export async function addLog(guildId: string, entry: { ruleId: number | null; ruleName: string; userId: string; channelId: string | null; trigger: string; effects: string[] }): Promise<void> {
  const pool = getPrimaryPool();
  await pool.query('insert into mod_rule_logs (guild_id, rule_id, rule_name, user_id, channel_id, trigger, effects) values ($1, $2, $3, $4, $5, $6, $7)',
    [guildId, entry.ruleId, entry.ruleName.slice(0, 60), entry.userId, entry.channelId, entry.trigger.slice(0, 120), entry.effects]);
  written += 1;
  if (written % 25 === 0) {
    await pool.query('delete from mod_rule_logs where guild_id = $1 and id not in (select id from mod_rule_logs where guild_id = $1 order by id desc limit $2)', [guildId, KEPT_LOGS]).catch(() => undefined);
  }
}
