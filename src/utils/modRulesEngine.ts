// Runs the moderation rules of a server on a message (see utils/modRules.ts for what a rule is and db/modRules.ts for where they are kept).
// The rules are made in the dashboard; this only reads them. The effects that are quick and harmless (delete, reply, the counters and the heat) happen on every match; the
// sanctions wait for the threshold of the rule (N matches by the same member in M minutes, 1 by default). Sanctions go through the same cases, DMs and logs as the
// other automod (`applyAutomodAction`), so they show up in the history of the member like anything a moderator did. A rule in test mode (`dry_run`) only writes in the log
// what it would have done.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/modRulesEngine.js, which is what the bot loads.
import { PermissionFlagsBits } from 'discord.js';
import type { Guild, GuildMember, Message } from 'discord.js';
import { Recent, evaluateRule, checkConditions, fillText, needsOf, escalatedMinutes, IMMEDIATE_EFFECTS } from './modRules';
import type { Effect, MessageFacts } from './modRules';
import { load, countHit, addLog, addViolation, countViolations, resetViolations, getHeat, addHeat, resetHeat } from '../db/modRules';
import type { Compiled, CompiledRule, Settings } from '../db/modRules';

const logger = require('./logger') as { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
const { t, currentLanguage } = require('../i18n') as { t: (lang: string, key: string, values?: Record<string, unknown>) => string; currentLanguage: () => string };
const { applyAutomodAction } = require('./automodAction') as { applyAutomodAction: (message: Message, options: Record<string, unknown>) => Promise<void> };
const { createCase } = require('../db/modActions') as { createCase: (options: Record<string, unknown>) => Promise<Record<string, unknown>> };
const { logSanction } = require('./caseLog') as { logSanction: (client: unknown, guild: unknown, options: Record<string, unknown>) => Promise<void> };
const { sendDm } = require('./dmOrigin') as { sendDm: (user: unknown, payload: unknown) => Promise<unknown> };
const tempRoles = require('../db/tempRoles') as { addTempRole: (guildId: string, userId: string, roleId: string, setBy: string, expiresAt: string) => Promise<unknown> };

export const recent = new Recent();
const SWEEP_MS = 5 * 60_000;
const MAX_MEMORY_MS = 24 * 60 * 60_000;
setInterval(() => recent.sweep(Date.now(), MAX_MEMORY_MS), SWEEP_MS).unref?.();

type AnyChannel = { parentId?: string | null; parent?: { parentId?: string | null } | null; isThread?: () => boolean };

export function factsOf(message: Message, edited: boolean): MessageFacts {
  const member = message.member!;
  const channel = message.channel as unknown as AnyChannel;
  const isThread = typeof channel.isThread === 'function' && channel.isThread();
  const day = 86_400_000;
  return {
    guildId: message.guild!.id,
    content: message.content ?? '',
    channelId: message.channelId,
    parentId: channel.parentId ?? null,
    categoryId: isThread ? channel.parent?.parentId ?? null : channel.parentId ?? null,
    roleIds: new Set(member.roles.cache.keys()),
    accountAgeDays: (Date.now() - message.author.createdTimestamp) / day,
    memberAgeDays: member.joinedTimestamp ? (Date.now() - member.joinedTimestamp) / day : 9999,
    users: message.mentions.users.size,
    roles: message.mentions.roles.size,
    everyone: message.mentions.everyone,
    attachments: [...message.attachments.values()].map((a) => ({ contentType: a.contentType ?? null, name: a.name ?? '' })),
    isBot: message.author.bot || Boolean(message.webhookId),
    isEdit: edited,
    isThread,
    username: message.author.username,
    nickname: member.nickname ?? member.displayName ?? null,
    extra: { violations: {}, heat: 0 },
  };
}

const slowmodeTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; previous: number }>();

async function applyEffect(message: Message, rule: CompiledRule, settings: Settings, effect: Effect): Promise<string | null> {
  const member = message.member!;
  const guild = message.guild!;
  const values = { user: `<@${message.author.id}>`, username: message.author.username, server: guild.name, channel: `<#${message.channelId}>`, rule: rule.name };
  const lang = currentLanguage();
  const reason = (custom: unknown): string => fillText(String(custom || t(lang, 'modrules.reason', { rule: rule.name })), values);
  const type = `rule:${rule.name}`;
  const send = async (channelId: string, body: string): Promise<boolean> => {
    const channel = guild.channels.cache.get(channelId) as { send?: (o: unknown) => Promise<unknown> } | undefined;
    return Boolean(channel?.send && (await channel.send({ content: body, allowedMentions: { parse: [] } }).then(() => true, () => false)));
  };
  switch (effect.type) {
    case 'delete': return (await message.delete().then(() => true, () => false)) ? 'delete' : null;
    case 'reply': {
      const body = fillText(String(effect.text ?? ''), values).trim();
      if (!body) return null;
      const sent = await (message.channel as unknown as { send: (o: unknown) => Promise<Message> }).send({ content: body, allowedMentions: { users: [message.author.id] } }).catch(() => null);
      const after = Number(effect.delete_after ?? 0);
      if (sent && after > 0) setTimeout(() => sent.delete().catch(() => undefined), after * 1000).unref?.();
      return sent ? 'reply' : null;
    }
    case 'dm': {
      const body = fillText(String(effect.text ?? ''), values).trim();
      if (!body) return null;
      return (await sendDm(message.author, { content: body }).then(() => true, () => false)) ? 'dm' : null;
    }
    case 'warn': await applyAutomodAction(message, { violationType: type, reason: reason(effect.reason), action: 'warn', keepMessage: true }); return 'warn';
    case 'timeout': {
      if (!member.moderatable) return null;
      // A timeout that grows: the base, times the multiplier once for every time this rule already timed the member out in the window.
      const window = Number(effect.window_hours ?? 168) * 60;
      const before = Number(effect.multiplier ?? 1) > 1 ? await countViolations(guild.id, message.author.id, `escalate:${rule.id}`, window) : 0;
      const minutes = escalatedMinutes(Number(effect.minutes ?? 10), Number(effect.multiplier ?? 1), before, Number(effect.max_minutes ?? 40320));
      if (Number(effect.multiplier ?? 1) > 1) await addViolation(guild.id, message.author.id, `escalate:${rule.id}`, window);
      await applyAutomodAction(message, { violationType: type, reason: reason(null), action: 'tempmute', durationMs: minutes * 60_000, keepMessage: true });
      return `timeout ${minutes}m`;
    }
    case 'kick': {
      if (!member.kickable) return null;
      await applyAutomodAction(message, { violationType: type, reason: reason(null), action: 'kick', keepMessage: true });
      return 'kick';
    }
    case 'ban': {
      if (!member.bannable) return null;
      const why = reason(effect.reason);
      await sendDm(message.author, { content: t(lang, 'modrules.banDm', { server: guild.name, reason: why }) }).catch(() => undefined);
      const banned = await guild.members.ban(message.author.id, { reason: why, deleteMessageSeconds: Number(effect.delete_days ?? 0) * 86_400 }).then(() => true, () => false);
      if (!banned) return null;
      const modCase = await createCase({ guildId: guild.id, userId: message.author.id, moderatorId: message.client.user!.id, type: 'ban', reason: why, source: 'automod' });
      await logSanction(message.client, guild, { modCase, target: message.author, moderator: message.client.user, reason: why, source: 'automod' }).catch(() => undefined);
      return 'ban';
    }
    case 'add_role': case 'remove_role': {
      const role = guild.roles.cache.get(String(effect.role_id ?? ''));
      if (!role || !role.editable) return null;
      const done = await (effect.type === 'add_role' ? member.roles.add(role, reason(null)) : member.roles.remove(role, reason(null))).then(() => true, () => false);
      return done ? effect.type : null;
    }
    case 'temp_role': {
      const role = guild.roles.cache.get(String(effect.role_id ?? ''));
      if (!role || !role.editable) return null;
      if (!(await member.roles.add(role, reason(null)).then(() => true, () => false))) return null;
      await tempRoles.addTempRole(guild.id, message.author.id, role.id, message.client.user!.id, new Date(Date.now() + Number(effect.minutes ?? 60) * 60_000).toISOString());
      return `temp_role ${effect.minutes}m`; // i18n-ignore: the name of the effect, as the log of the rules shows it
    }
    case 'purge': {
      const channel = message.channel as unknown as { messages?: { fetch: (o: unknown) => Promise<Map<string, Message>> }; bulkDelete?: (m: Message[], filter: boolean) => Promise<unknown> };
      if (!channel.messages || !channel.bulkDelete) return null;
      const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched) return null;
      const since = Date.now() - Number(effect.minutes ?? 10) * 60_000;
      const mine = [...fetched.values()].filter((m) => m.author.id === message.author.id && m.createdTimestamp >= since).slice(0, Number(effect.count ?? 10));
      if (!mine.length) return null;
      return (await channel.bulkDelete(mine, true).then(() => true, () => false)) ? `purge ${mine.length}` : null;
    }
    case 'slowmode': {
      const channel = message.channel as unknown as { rateLimitPerUser?: number; setRateLimitPerUser?: (seconds: number, why: string) => Promise<unknown> };
      if (!channel.setRateLimitPerUser) return null;
      const key = `${guild.id}:${message.channelId}`;
      const running = slowmodeTimers.get(key);
      const previous = running ? running.previous : Number(channel.rateLimitPerUser ?? 0);
      if (running) clearTimeout(running.timer);
      if (!(await channel.setRateLimitPerUser(Number(effect.seconds ?? 10), reason(null)).then(() => true, () => false))) return null;
      const timer = setTimeout(() => { slowmodeTimers.delete(key); channel.setRateLimitPerUser?.(previous, reason(null)).catch(() => undefined); }, Number(effect.minutes ?? 10) * 60_000);
      timer.unref?.();
      slowmodeTimers.set(key, { timer, previous });
      return `slowmode ${effect.seconds}s`;
    }
    case 'alert': {
      const channelId = String(effect.channel_id || settings.log_channel_id || '');
      if (!channelId) return null;
      const custom = fillText(String(effect.text ?? ''), values).trim();
      const body = custom || t(lang, 'modrules.alert', { rule: rule.name, user: values.user, channel: values.channel });
      return (await send(channelId, body)) ? 'alert' : null;
    }
    case 'set_nickname': {
      if (!member.manageable) return null;
      const nickname = fillText(String(effect.nickname ?? ''), values).slice(0, 32);
      return (await member.setNickname(nickname || null, reason(null)).then(() => true, () => false)) ? 'set_nickname' : null;
    }
    case 'violation': { const count = await addViolation(guild.id, message.author.id, String(effect.name), 1440); return `violation ${effect.name}:${count}`; }
    case 'reset_violations': await resetViolations(guild.id, message.author.id, String(effect.name)); return `reset ${effect.name}`;
    case 'add_heat': { const heat = await addHeat(guild.id, message.author.id, Number(effect.amount ?? 20), settings.heat_decay); return `heat ${Math.round(heat)}`; }
    case 'reset_heat': await resetHeat(guild.id, message.author.id); return 'reset_heat';
    case 'quarantine': {
      const role = settings.quarantine_role_id ? guild.roles.cache.get(settings.quarantine_role_id) : null;
      if (!role || !role.editable) return null;
      return (await member.roles.add(role, reason(null)).then(() => true, () => false)) ? 'quarantine' : null;
    }
    case 'lockdown': {
      const { startLockdown } = require('./lockdown') as { startLockdown: (guild: Guild, options: Record<string, unknown>) => Promise<unknown> };
      return (await startLockdown(guild, { startedBy: message.client.user!.id, reason: reason(null), minutes: Number(effect.minutes ?? 10) }).then(() => true, () => false)) ? 'lockdown' : null;
    }
  }
  return null;
}

async function logToChannel(guild: Guild, settings: Settings, ruleName: string, userId: string, channelId: string, trigger: string, applied: string[], dryRun: boolean): Promise<void> {
  if (!settings.log_channel_id) return;
  const channel = guild.channels.cache.get(settings.log_channel_id) as { send?: (o: unknown) => Promise<unknown> } | undefined;
  if (!channel?.send) return;
  const lang = currentLanguage();
  await channel.send({
    content: t(lang, dryRun ? 'modrules.logDry' : 'modrules.log', { rule: ruleName, user: `<@${userId}>`, channel: `<#${channelId}>`, trigger: trigger.split(':')[0], effects: applied.join(', ') || t(lang, 'modrules.logNone') }),
    allowedMentions: { parse: [] },
  }).catch(() => undefined);
}

/** Fills what a rule has to ask of the database before it can be evaluated: its counters of violations and the heat of the member. */
async function fillExtra(facts: MessageFacts, rule: CompiledRule, settings: Settings, userId: string): Promise<void> {
  const needs = needsOf(rule);
  for (const need of needs.violations) {
    const key = `${need.name}|${need.minutes}`;
    if (facts.extra.violations[key] === undefined) facts.extra.violations[key] = await countViolations(facts.guildId, userId, need.name, need.minutes);
  }
  if (needs.heat) facts.extra.heat = await getHeat(facts.guildId, userId, settings.heat_decay);
}

/** Applies the effects of a rule that matched (or, in test mode, only lists them). Returns the effects that were applied. */
export async function applyRule(message: Message, rule: CompiledRule, settings: Settings, reached: boolean): Promise<string[]> {
  const applied: string[] = [];
  for (const effect of rule.effects) {
    if (!reached && !IMMEDIATE_EFFECTS.includes(effect.type)) continue;
    if (rule.dry_run) { applied.push(`dry-run:${effect.type}`); continue; }
    const done = await applyEffect(message, rule, settings, effect).catch((error: Error) => { logger.warn(`Rules: ${effect.type} of "${rule.name}" failed in ${message.guild!.id}: ${error.message}`); return null; });
    if (done) applied.push(done);
  }
  return applied;
}

/** Looks at one message with the rules of its server. Never throws: a broken rule must not stop the rest of the bot. */
export async function runModRules(message: Message, { edited = false }: { edited?: boolean } = {}): Promise<void> {
  try {
    if (!message.guild || !message.member) return;
    const compiled: Compiled = await load(message.guild.id);
    const { settings, rulesets, lists } = compiled;
    if (!settings.enabled || !rulesets.length) return;
    if ((message.author.bot || message.webhookId) && settings.ignore_bots) return;
    if (message.author.id === message.client.user?.id) return;
    if (settings.ignore_staff && message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    const facts = factsOf(message, edited);
    const now = Date.now();
    const base = `${message.guild.id}`;
    for (const set of rulesets) {
      if (!checkConditions(set.conditions, facts)) continue;
      for (const rule of set.rules) {
        await fillExtra(facts, rule, settings, message.author.id);
        const keys = { user: `${base}:${message.author.id}:${rule.id}`, channel: `${base}:${message.channelId}:${rule.id}` };
        const found = evaluateRule(rule, facts, lists, recent, keys, now);
        if (!found) continue;
        // The threshold: with more than one match needed, each match is written down (in the database, so a restart does not forget them) and the sanctions wait.
        const reached = rule.threshold_count <= 1 || (await addViolation(base, message.author.id, `rule:${rule.id}`, rule.threshold_minutes)) >= rule.threshold_count;
        const applied = await applyRule(message, rule, settings, reached);
        countHit(base, rule.id);
        addLog(base, { ruleId: rule.id, ruleName: rule.name, userId: message.author.id, channelId: message.channelId, trigger: found.join(' + '), effects: applied }).catch(() => undefined);
        await logToChannel(message.guild, settings, rule.name, message.author.id, message.channelId, found[0], applied, rule.dry_run);
        if (rule.stop && !rule.dry_run) return;
      }
    }
  } catch (error) {
    logger.error(`Rules failed for message ${message.id}:`, error);
  }
}

export type { GuildMember };
