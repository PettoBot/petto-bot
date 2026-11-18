// "Try this rule": the dashboard sends a rule (as it is in the form, not saved) and a sample message, and this says what the rule would do: which conditions pass, which triggers
// find something, and which effects would happen (and which would wait for the count). Nothing is done and nothing is written. The lists are the real lists of the server.
// A rule that looks at several messages (the same text again, too many messages) is tried by sending the sample `times` times.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/modRulesTest.js, which is what the bot loads.
import { Recent, cleanRule, checkCondition, matchTrigger, IMMEDIATE_EFFECTS } from './modRules';
import type { MessageFacts } from './modRules';
import { load } from '../db/modRules';

const int = (value: unknown, min: number, max: number, fallback: number): number => { const n = Math.floor(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String).filter((v) => /^\d{15,25}$/.test(v)).slice(0, 50) : []);

export interface TestResult {
  ok: boolean; error?: string; applies: boolean;
  conditions: Array<{ type: string; pass: boolean }>;
  triggers: Array<{ type: string; hit: string | null }>;
  effects: Array<{ type: string; when: 'now' | 'count' }>;
  notes: string[];
}

export async function testRule(guildId: string, draft: unknown, sample: unknown): Promise<TestResult> {
  const checked = cleanRule(draft);
  if (checked.ok === false) return { ok: false, error: checked.error, applies: false, conditions: [], triggers: [], effects: [], notes: [] };
  const rule = checked.rule;
  const o = (sample && typeof sample === 'object' ? sample : {}) as Record<string, unknown>;
  const { lists } = await load(guildId);
  const facts: MessageFacts = {
    guildId, content: String(o.content ?? '').slice(0, 4000), channelId: String(/^\d{15,25}$/.test(String(o.channel_id ?? '')) ? o.channel_id : '1'), parentId: null,
    categoryId: /^\d{15,25}$/.test(String(o.category_id ?? '')) ? String(o.category_id) : null,
    roleIds: new Set(ids(o.role_ids)), accountAgeDays: int(o.account_age_days, 0, 99999, 400), memberAgeDays: int(o.member_age_days, 0, 99999, 100),
    users: int(o.users, 0, 200, 0), roles: int(o.roles, 0, 200, 0), everyone: o.everyone === true,
    attachments: Array.from({ length: int(o.attachments, 0, 20, 0) }, (_x, i) => ({ contentType: 'image/png', name: `a${i}.png` })),
    isBot: o.is_bot === true, isEdit: o.is_edit === true, isThread: o.is_thread === true, username: String(o.username ?? 'sample').slice(0, 32), nickname: o.nickname ? String(o.nickname).slice(0, 32) : null,
    extra: { violations: {}, heat: int(o.heat, 0, 100000, 0) },
  };
  for (const trigger of rule.triggers) if (trigger.type === 'violations') facts.extra.violations[`${trigger.name}|${trigger.minutes}`] = int(o.violations, 0, 1000, 0);
  const notes: string[] = [];
  const times = int(o.times, 1, 50, 1);
  if (times > 1) notes.push('times');
  const conditions = rule.conditions.map((c) => ({ type: c.type, pass: checkCondition(c, facts) }));
  const recent = new Recent();
  const keys = { user: 'test:user', channel: 'test:channel' };
  let triggers: TestResult['triggers'] = [];
  const now = Date.now();
  for (let i = 0; i < times; i += 1) triggers = rule.triggers.map((t) => ({ type: t.type, hit: matchTrigger(t, facts, lists, recent, keys, now + i * 100) }));
  if (rule.triggers.some((t) => ['violations', 'heat'].includes(t.type))) notes.push('state');
  const passed = conditions.every((c) => c.pass);
  const hits = triggers.filter((t) => t.hit !== null).length;
  const applies = passed && (rule.trigger_mode === 'all' ? hits === triggers.length : hits > 0);
  return {
    ok: true, applies, conditions, triggers, notes,
    effects: rule.effects.map((e) => ({ type: e.type, when: IMMEDIATE_EFFECTS.includes(e.type) || rule.threshold_count <= 1 ? 'now' as const : 'count' as const })),
  };
}
