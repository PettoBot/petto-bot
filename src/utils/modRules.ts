// The moderation rules made in the dashboard, typed: what a rule can look for (triggers), who and where it applies (conditions) and what it does
// (effects). Plain functions and no Discord and no database, so they are checked on their own (scripts/check-mod-rules.js). `modRulesEngine.ts` reads
// the messages and applies the effects. What the dashboard saves is cleaned here too (`cleanRule`), so a hand-made request cannot save anything else.

export const TRIGGER_TYPES = ['words', 'regex', 'links', 'invites', 'mentions', 'caps', 'emojis', 'repeated', 'rate', 'attachments', 'length', 'zalgo', 'repeated_chars'] as const;
export const CONDITION_TYPES = ['channel', 'category', 'role', 'account_age', 'member_age', 'no_roles'] as const;
export const EFFECT_TYPES = ['delete', 'reply', 'dm', 'warn', 'timeout', 'kick', 'ban', 'add_role', 'remove_role'] as const;
/** The effects that happen on every match; the others wait for the threshold of the rule (a member who does it N times in M minutes). */
export const IMMEDIATE_EFFECTS: readonly string[] = ['delete', 'reply'];

export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type ConditionType = (typeof CONDITION_TYPES)[number];
export type EffectType = (typeof EFFECT_TYPES)[number];

export const LIMITS = { words: 500, domains: 200, ids: 50, triggers: 10, conditions: 10, effects: 8, rulesPerSet: 50, rulesets: 20, lists: 30, text: 500, regex: 200, listName: 60 } as const;

export interface Trigger { type: TriggerType; [key: string]: unknown }
export interface Condition { type: ConditionType; [key: string]: unknown }
export interface Effect { type: EffectType; [key: string]: unknown }

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const int = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const SNOWFLAKE = /^\d{15,25}$/;
const ids = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.map(String).filter((v) => SNOWFLAKE.test(v)))].slice(0, LIMITS.ids) : []);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const text = (value: unknown, max: number): string => String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

/** Lowercase, no accents, no invisible characters: how a message and the words of a list are compared. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[​-‏⁠-⁤﻿]/g, '').toLowerCase();
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A pattern the server wrote: short, valid, and without the shapes that make a regular expression run for ever (a group repeated inside a group). */
export function safeRegex(pattern: unknown): RegExp | null {
  const source = String(pattern ?? '');
  if (!source || source.length > LIMITS.regex) return null;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(source) || /\\[1-9]/.test(source) || /\(\?[=!<]/.test(source)) return null;
  try { return new RegExp(source, 'iu'); } catch { return null; }
}

/** The words of a list as a function: whether a text has one of them, as part of a word, as a whole word, or is exactly one. */
export function wordMatcher(words: readonly string[], match: 'contains' | 'word' | 'exact'): (content: string) => string | null {
  const clean = [...new Set(words.map((word) => normalizeText(String(word)).trim()).filter(Boolean))].slice(0, LIMITS.words);
  if (!clean.length) return () => null;
  if (match === 'exact') {
    const set = new Set(clean);
    return (content) => { const found = normalizeText(content).trim(); return set.has(found) ? found : null; };
  }
  const body = clean.sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  const re = match === 'word' ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'u') : new RegExp(body, 'u');
  return (content) => re.exec(normalizeText(content))?.[0] ?? null;
}

const HOST = /(?:https?:\/\/|www\.)([a-z0-9][a-z0-9.-]*[a-z0-9])(?::\d+)?/gi;
/** The hosts of the links of a text (only links with `http(s)://` or `www.`: a file name is not a link). */
export function linkHosts(content: string): string[] {
  const hosts: string[] = [];
  for (const match of content.matchAll(HOST)) hosts.push(match[1].toLowerCase().replace(/^www\./, ''));
  return hosts;
}
export const hostMatches = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);
const cleanDomain = (value: string): string => value.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
export const cleanDomains = (list: unknown): string[] => (Array.isArray(list) ? [...new Set(list.map((item) => cleanDomain(String(item))).filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)))].slice(0, LIMITS.domains) : []);
export const cleanWords = (list: unknown): string[] => (Array.isArray(list) ? [...new Set(list.map((item) => text(item, 80)).filter(Boolean))].slice(0, LIMITS.words) : []);

// ---- What the dashboard saves ------------------------------------------------------------------------------------------------------------------------

export function cleanTrigger(raw: unknown): Trigger | null {
  const o = asObject(raw);
  const type = oneOf(o.type, TRIGGER_TYPES, 'words');
  if (!TRIGGER_TYPES.includes(o.type as TriggerType)) return null;
  switch (type) {
    case 'words': return { type, list_id: Number(o.list_id) > 0 ? Number(o.list_id) : null, words: cleanWords(o.words), match: oneOf(o.match, ['contains', 'word', 'exact'] as const, 'word') };
    case 'regex': return safeRegex(o.pattern) ? { type, pattern: String(o.pattern) } : null;
    case 'links': return { type, mode: oneOf(o.mode, ['any', 'deny', 'allow'] as const, 'any'), list_id: Number(o.list_id) > 0 ? Number(o.list_id) : null, domains: cleanDomains(o.domains) };
    case 'invites': return { type };
    case 'mentions': return { type, kind: oneOf(o.kind, ['any', 'users', 'roles', 'everyone'] as const, 'any'), max: int(o.max, 0, 100, 5) };
    case 'caps': return { type, percent: int(o.percent, 30, 100, 70), min_length: int(o.min_length, 5, 500, 12) };
    case 'emojis': return { type, max: int(o.max, 1, 200, 10) };
    case 'repeated': return { type, times: int(o.times, 2, 20, 3), seconds: int(o.seconds, 3, 600, 30) };
    case 'rate': return { type, messages: int(o.messages, 2, 50, 6), seconds: int(o.seconds, 2, 120, 8) };
    case 'attachments': return { type, kind: oneOf(o.kind, ['any', 'images', 'files'] as const, 'any'), max: int(o.max, 0, 20, 0) };
    case 'length': return { type, max_chars: int(o.max_chars, 0, 4000, 0), max_lines: int(o.max_lines, 0, 200, 0) };
    case 'zalgo': return { type, max: int(o.max, 3, 100, 8) };
    case 'repeated_chars': return { type, max: int(o.max, 3, 100, 10) };
  }
  return null;
}

export function cleanCondition(raw: unknown): Condition | null {
  const o = asObject(raw);
  if (!CONDITION_TYPES.includes(o.type as ConditionType)) return null;
  const type = o.type as ConditionType;
  switch (type) {
    case 'channel': case 'category': return { type, mode: oneOf(o.mode, ['in', 'not_in'] as const, 'not_in'), ids: ids(o.ids) };
    case 'role': return { type, mode: oneOf(o.mode, ['has_any', 'has_none'] as const, 'has_none'), ids: ids(o.ids) };
    case 'account_age': case 'member_age': return { type, max_days: int(o.max_days, 1, 3650, 7) };
    case 'no_roles': return { type };
  }
  return null;
}

export function cleanEffect(raw: unknown): Effect | null {
  const o = asObject(raw);
  if (!EFFECT_TYPES.includes(o.type as EffectType)) return null;
  const type = o.type as EffectType;
  switch (type) {
    case 'delete': case 'kick': return { type };
    case 'reply': return { type, text: text(o.text, LIMITS.text), delete_after: int(o.delete_after, 0, 600, 10) };
    case 'dm': return { type, text: text(o.text, LIMITS.text) };
    case 'warn': return { type, reason: text(o.reason, 200) };
    case 'timeout': return { type, minutes: int(o.minutes, 1, 40320, 10) };
    case 'ban': return { type, reason: text(o.reason, 200), delete_days: int(o.delete_days, 0, 7, 0) };
    case 'add_role': case 'remove_role': return SNOWFLAKE.test(String(o.role_id ?? '')) ? { type, role_id: String(o.role_id) } : null;
  }
  return null;
}

const cleanList = <T>(raw: unknown, clean: (item: unknown) => T | null, max: number): T[] => (Array.isArray(raw) ? raw.map(clean).filter((item): item is T => item !== null).slice(0, max) : []);

export interface RuleInput {
  name: string; enabled: boolean; trigger_mode: 'any' | 'all'; triggers: Trigger[]; conditions: Condition[]; effects: Effect[];
  threshold_count: number; threshold_minutes: number; stop: boolean;
}

/** A rule as the dashboard saves it, cleaned. A rule with nothing to look for or nothing to do is refused (`error`). */
export function cleanRule(raw: unknown): { ok: true; rule: RuleInput } | { ok: false; error: string } {
  const o = asObject(raw);
  const name = text(o.name, LIMITS.listName);
  if (!name) return { ok: false, error: 'name' };
  const triggers = cleanList(o.triggers, cleanTrigger, LIMITS.triggers);
  if (!triggers.length) return { ok: false, error: 'triggers' };
  const effects = cleanList(o.effects, cleanEffect, LIMITS.effects);
  if (!effects.length) return { ok: false, error: 'effects' };
  return {
    ok: true,
    rule: {
      name, enabled: o.enabled !== false, trigger_mode: oneOf(o.trigger_mode, ['any', 'all'] as const, 'any'), triggers, effects,
      conditions: cleanList(o.conditions, cleanCondition, LIMITS.conditions),
      threshold_count: int(o.threshold_count, 1, 50, 1), threshold_minutes: int(o.threshold_minutes, 1, 1440, 10), stop: o.stop !== false,
    },
  };
}

export const cleanConditions = (raw: unknown): Condition[] => cleanList(raw, cleanCondition, LIMITS.conditions);

// ---- Looking at a message ----------------------------------------------------------------------------------------------------------------------------

/** What the engine knows about a message and its author. */
export interface MessageFacts {
  content: string; channelId: string; parentId: string | null; categoryId: string | null;
  roleIds: ReadonlySet<string>; accountAgeDays: number; memberAgeDays: number;
  users: number; roles: number; everyone: boolean;
  attachments: ReadonlyArray<{ contentType: string | null; name: string }>;
}

export interface Lists { words: ReadonlyMap<number, string[]>; domains: ReadonlyMap<number, string[]> }

/** The memory of a rule that looks at several messages (`repeated`, `rate`): timestamps by member, forgotten after their window. */
export class Recent {
  private readonly seen = new Map<string, Array<{ at: number; key: string }>>();
  /** Writes one message and returns how many (with the same `key` when given) the member has sent in the last `windowMs`. */
  add(id: string, now: number, windowMs: number, key?: string): number {
    const kept = (this.seen.get(id) ?? []).filter((entry) => now - entry.at <= windowMs);
    kept.push({ at: now, key: key ?? '' });
    this.seen.set(id, kept);
    return key === undefined ? kept.length : kept.filter((entry) => entry.key === key).length;
  }
  /** Forgets what is older than `maxAgeMs`, so the memory does not grow with every member who ever wrote. */
  sweep(now: number, maxAgeMs: number): void {
    for (const [id, entries] of this.seen) {
      const kept = entries.filter((entry) => now - entry.at <= maxAgeMs);
      if (kept.length) this.seen.set(id, kept); else this.seen.delete(id);
    }
  }
  get size(): number { return this.seen.size; }
}

const EMOJI = /\p{Extended_Pictographic}|<a?:\w+:\d+>/gu;
const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const MARKS = /\p{M}/gu;

/** The name of what matched, for the log: the trigger and, when there is one, the word or the host. Null when it did not match. */
export function matchTrigger(trigger: Trigger, facts: MessageFacts, lists: Lists, recent: Recent, userKey: string, now: number): string | null {
  const content = facts.content;
  switch (trigger.type) {
    case 'words': {
      const list = typeof trigger.list_id === 'number' ? lists.words.get(trigger.list_id) ?? [] : [];
      const words = [...list, ...((trigger.words as string[] | undefined) ?? [])];
      const hit = wordMatcher(words, (trigger.match as 'contains' | 'word' | 'exact') ?? 'word')(content);
      return hit === null ? null : `words:${hit}`;
    }
    case 'regex': { const re = safeRegex(trigger.pattern); return re && re.test(content) ? 'regex' : null; }
    case 'links': {
      const hosts = linkHosts(content);
      const mode = (trigger.mode as string) ?? 'any';
      const list = typeof trigger.list_id === 'number' ? lists.domains.get(trigger.list_id) ?? [] : [];
      const domains = [...list, ...((trigger.domains as string[] | undefined) ?? [])];
      if (mode === 'any') return hosts.length ? `links:${hosts[0]}` : null;
      if (mode === 'deny') {
        const lowered = content.toLowerCase();
        const hit = domains.find((domain) => hosts.some((host) => hostMatches(host, domain)) || new RegExp(`(?<![a-z0-9.-])${escapeRegex(domain)}(?![a-z0-9-])`).test(lowered));
        return hit ? `links:${hit}` : null;
      }
      const outside = hosts.find((host) => !domains.some((domain) => hostMatches(host, domain)));
      return outside ? `links:${outside}` : null;
    }
    case 'invites': return INVITE.test(content) ? 'invites' : null;
    case 'mentions': {
      const max = Number(trigger.max ?? 5);
      const kind = (trigger.kind as string) ?? 'any';
      const count = kind === 'users' ? facts.users : kind === 'roles' ? facts.roles : kind === 'everyone' ? (facts.everyone ? max + 1 : 0) : facts.users + facts.roles + (facts.everyone ? 1 : 0);
      return count > max ? `mentions:${count}` : null;
    }
    case 'caps': {
      const letters = content.replace(/[^\p{L}]/gu, '');
      if (letters.length < Number(trigger.min_length ?? 12)) return null;
      const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
      return upper / letters.length * 100 >= Number(trigger.percent ?? 70) ? 'caps' : null;
    }
    case 'emojis': return (content.match(EMOJI)?.length ?? 0) > Number(trigger.max ?? 10) ? 'emojis' : null;
    case 'repeated': {
      const normalized = normalizeText(content).replace(/\s+/g, ' ').trim();
      if (!normalized) return null;
      const times = Number(trigger.times ?? 3);
      const count = recent.add(`rep:${userKey}`, now, Number(trigger.seconds ?? 30) * 1000, normalized);
      return count >= times ? 'repeated' : null;
    }
    case 'rate': {
      const count = recent.add(`rate:${userKey}`, now, Number(trigger.seconds ?? 8) * 1000);
      return count >= Number(trigger.messages ?? 6) ? 'rate' : null;
    }
    case 'attachments': {
      const kind = (trigger.kind as string) ?? 'any';
      const isImage = (a: { contentType: string | null; name: string }) => /^image\//.test(a.contentType ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name);
      const chosen = kind === 'images' ? facts.attachments.filter(isImage) : kind === 'files' ? facts.attachments.filter((a) => !isImage(a)) : facts.attachments;
      return chosen.length > Number(trigger.max ?? 0) ? `attachments:${chosen.length}` : null;
    }
    case 'length': {
      const chars = Number(trigger.max_chars ?? 0);
      const lines = Number(trigger.max_lines ?? 0);
      if (chars && content.length > chars) return 'length:chars';
      if (lines && content.split('\n').length > lines) return 'length:lines';
      return null;
    }
    case 'zalgo': return (content.match(MARKS)?.length ?? 0) >= Number(trigger.max ?? 8) ? 'zalgo' : null;
    case 'repeated_chars': { const max = Number(trigger.max ?? 10); return new RegExp(`(\\P{M}\\p{M}*)\\1{${max},}`, 'u').test(content) ? 'repeated_chars' : null; }
  }
  return null;
}

/** Whether a condition holds for the message. Conditions with nothing chosen hold (an empty list does not block anybody). */
export function checkCondition(condition: Condition, facts: MessageFacts): boolean {
  const list = (condition.ids as string[] | undefined) ?? [];
  switch (condition.type) {
    case 'channel': { const here = list.includes(facts.channelId) || (facts.parentId !== null && list.includes(facts.parentId)); return !list.length || (condition.mode === 'in' ? here : !here); }
    case 'category': { const here = facts.categoryId !== null && list.includes(facts.categoryId); return !list.length || (condition.mode === 'in' ? here : !here); }
    case 'role': { const has = list.some((id) => facts.roleIds.has(id)); return !list.length || (condition.mode === 'has_any' ? has : !has); }
    case 'account_age': return facts.accountAgeDays <= Number(condition.max_days ?? 7);
    case 'member_age': return facts.memberAgeDays <= Number(condition.max_days ?? 7);
    case 'no_roles': return facts.roleIds.size === 0;
  }
  return true;
}

export const checkConditions = (conditions: readonly Condition[], facts: MessageFacts): boolean => conditions.every((condition) => checkCondition(condition, facts));

export interface RuleLike { trigger_mode: string; triggers: readonly Trigger[]; conditions: readonly Condition[] }

/** What matched, one entry per trigger that did (all of them when `trigger_mode` is `all`), or null when the rule does not apply. */
export function evaluateRule(rule: RuleLike, facts: MessageFacts, lists: Lists, recent: Recent, userKey: string, now: number): string[] | null {
  if (!checkConditions(rule.conditions, facts)) return null;
  const found: string[] = [];
  for (const trigger of rule.triggers) {
    const hit = matchTrigger(trigger, facts, lists, recent, userKey, now);
    if (hit !== null) found.push(hit);
    else if (rule.trigger_mode === 'all') return null;
  }
  return found.length ? found : null;
}

/** The threshold of a rule: the effect after the first N matches in M minutes of the same member. */
export function thresholdReached(recent: Recent, key: string, now: number, count: number, minutes: number): boolean {
  return recent.add(`hit:${key}`, now, minutes * 60_000) >= count;
}

/** The text of a reply or a message with {user}, {username}, {server}, {channel} and {rule} filled in. */
export function fillText(template: string, values: Record<string, string>): string {
  return template.replace(/\{(user|username|server|channel|rule)\}/g, (_all, key: string) => values[key] ?? '');
}
