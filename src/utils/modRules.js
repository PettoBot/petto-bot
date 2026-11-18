"use strict";
// The moderation rules made in the dashboard, typed: what a rule can look for (triggers), who and where it applies (conditions) and what it does
// (effects). Plain functions and no Discord and no database, so they are checked on their own (scripts/check-mod-rules.js). `modRulesEngine.ts` reads
// the messages and applies the effects. What the dashboard saves is cleaned here too (`cleanRule`), so a hand-made request cannot save anything else.
Object.defineProperty(exports, "__esModule", { value: true });
exports.strongestAction = exports.DEFAULT_GATE = exports.RAID_ACTIONS = exports.GATE_ACTIONS = exports.checkConditions = exports.Recent = exports.cleanConditions = exports.cleanWords = exports.cleanDomains = exports.hostMatches = exports.counterName = exports.WASM_FROM = exports.LIMITS = exports.IMMEDIATE_EFFECTS = exports.EFFECT_TYPES = exports.CONDITION_TYPES = exports.TRIGGER_TYPES = void 0;
exports.normalizeText = normalizeText;
exports.safeRegex = safeRegex;
exports.wordMatcher = wordMatcher;
exports.linkHosts = linkHosts;
exports.cleanTrigger = cleanTrigger;
exports.cleanCondition = cleanCondition;
exports.cleanEffect = cleanEffect;
exports.cleanRule = cleanRule;
exports.matchTrigger = matchTrigger;
exports.checkCondition = checkCondition;
exports.evaluateRule = evaluateRule;
exports.needsOf = needsOf;
exports.escalatedMinutes = escalatedMinutes;
exports.decayedHeat = decayedHeat;
exports.fillText = fillText;
exports.cleanJoinGate = cleanJoinGate;
exports.gateFindings = gateFindings;
exports.TRIGGER_TYPES = [
    'words', 'regex', 'links', 'invites', 'mentions', 'caps', 'emojis', 'repeated', 'rate', 'attachments', 'length', 'zalgo', 'repeated_chars',
    'channel_rate', 'mention_rate', 'attachment_rate', 'link_rate', 'name', 'violations', 'heat',
];
exports.CONDITION_TYPES = ['channel', 'category', 'role', 'account_age', 'member_age', 'no_roles', 'author_kind', 'message_kind', 'thread'];
exports.EFFECT_TYPES = [
    'delete', 'reply', 'dm', 'warn', 'timeout', 'kick', 'ban', 'add_role', 'remove_role',
    'purge', 'slowmode', 'alert', 'set_nickname', 'temp_role', 'violation', 'reset_violations', 'add_heat', 'reset_heat', 'quarantine', 'lockdown',
];
/** The effects that happen on every match; the others (the sanctions) wait for the threshold of the rule (a member who does it N times in M minutes). */
exports.IMMEDIATE_EFFECTS = ['delete', 'reply', 'violation', 'reset_violations', 'add_heat', 'reset_heat'];
exports.LIMITS = { words: 5000, domains: 1000, ids: 50, triggers: 10, conditions: 10, effects: 10, rulesPerSet: 50, rulesets: 20, lists: 30, text: 500, regex: 200, listName: 60, counterName: 40 };
/** From this many words a list is looked for by the Rust finder (utils/wordMatchWasm.ts) instead of one regular expression. */
exports.WASM_FROM = 300;
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const int = (value, min, max, fallback) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const SNOWFLAKE = /^\d{15,25}$/;
const ids = (value) => (Array.isArray(value) ? [...new Set(value.map(String).filter((v) => SNOWFLAKE.test(v)))].slice(0, exports.LIMITS.ids) : []);
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const text = (value, max) => String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const channelOrNone = (value) => (SNOWFLAKE.test(String(value ?? '')) ? String(value) : '');
/** The name of a counter of violations: lowercase letters, numbers, dashes and underscores. */
const counterName = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, exports.LIMITS.counterName) || 'default';
exports.counterName = counterName;
/** Lowercase, no accents, no invisible characters: how a message and the words of a list are compared. */
function normalizeText(value) {
    return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[​-‏⁠-⁤﻿]/g, '').toLowerCase();
}
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A pattern the server wrote: short, valid, and without the shapes that make a regular expression run for ever (a group repeated inside a group). */
function safeRegex(pattern) {
    const source = String(pattern ?? '');
    if (!source || source.length > exports.LIMITS.regex)
        return null;
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(source) || /\\[1-9]/.test(source) || /\(\?[=!<]/.test(source))
        return null;
    try {
        return new RegExp(source, 'iu');
    }
    catch {
        return null;
    }
}
let wasmBuilder;
function wasm() {
    if (wasmBuilder === undefined) {
        try {
            wasmBuilder = require('./wordMatchWasm').buildWasmMatcher;
        }
        catch {
            wasmBuilder = null;
        }
    }
    return wasmBuilder;
}
/**
 * The words of a list as a function: whether a text has one of them, as part of a word, as a whole word, or is exactly one. A list of thousands of words is looked
 * for by the Rust finder when it loads; the answer is the same with or without it (`useWasm: false` is how it is checked).
 */
function wordMatcher(words, match, { useWasm = true } = {}) {
    const clean = [...new Set(words.map((word) => normalizeText(String(word)).replace(/\n/g, ' ').trim()).filter(Boolean))].slice(0, exports.LIMITS.words);
    if (!clean.length)
        return () => null;
    if (match === 'exact') {
        const set = new Set(clean);
        return (content) => { const found = normalizeText(content).trim(); return set.has(found) ? found : null; };
    }
    if (useWasm && clean.length >= exports.WASM_FROM) {
        const build = wasm();
        const found = build ? build(clean, match === 'word') : null;
        if (found)
            return (content) => found(normalizeText(content));
    }
    const body = [...clean].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
    const re = match === 'word' ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'u') : new RegExp(body, 'u');
    return (content) => re.exec(normalizeText(content))?.[0] ?? null;
}
const HOST = /(?:https?:\/\/|www\.)([a-z0-9][a-z0-9.-]*[a-z0-9])(?::\d+)?/gi;
/** The hosts of the links of a text (only links with `http(s)://` or `www.`: a file name is not a link). */
function linkHosts(content) {
    const hosts = [];
    for (const match of content.matchAll(HOST))
        hosts.push(match[1].toLowerCase().replace(/^www\./, ''));
    return hosts;
}
const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
exports.hostMatches = hostMatches;
const cleanDomain = (value) => value.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
const cleanDomains = (list) => (Array.isArray(list) ? [...new Set(list.map((item) => cleanDomain(String(item))).filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)))].slice(0, exports.LIMITS.domains) : []);
exports.cleanDomains = cleanDomains;
const cleanWords = (list) => (Array.isArray(list) ? [...new Set(list.map((item) => text(item, 80).replace(/\n/g, ' ')).filter(Boolean))].slice(0, exports.LIMITS.words) : []);
exports.cleanWords = cleanWords;
// ---- What the dashboard saves ------------------------------------------------------------------------------------------------------------------------
function cleanTrigger(raw) {
    const o = asObject(raw);
    if (!exports.TRIGGER_TYPES.includes(o.type))
        return null;
    const type = o.type;
    const list = Number(o.list_id) > 0 ? Number(o.list_id) : null;
    switch (type) {
        case 'words': return { type, list_id: list, words: (0, exports.cleanWords)(o.words), match: oneOf(o.match, ['contains', 'word', 'exact'], 'word') };
        case 'regex': return safeRegex(o.pattern) ? { type, pattern: String(o.pattern) } : null;
        case 'links': return { type, mode: oneOf(o.mode, ['any', 'deny', 'allow'], 'any'), list_id: list, domains: (0, exports.cleanDomains)(o.domains) };
        case 'invites': return { type };
        case 'mentions': return { type, kind: oneOf(o.kind, ['any', 'users', 'roles', 'everyone'], 'any'), max: int(o.max, 0, 100, 5) };
        case 'caps': return { type, percent: int(o.percent, 30, 100, 70), min_length: int(o.min_length, 5, 500, 12) };
        case 'emojis': return { type, max: int(o.max, 1, 200, 10) };
        case 'repeated': return { type, times: int(o.times, 2, 20, 3), seconds: int(o.seconds, 3, 600, 30) };
        case 'rate': return { type, messages: int(o.messages, 2, 50, 6), seconds: int(o.seconds, 2, 120, 8) };
        case 'attachments': return { type, kind: oneOf(o.kind, ['any', 'images', 'files'], 'any'), max: int(o.max, 0, 20, 0) };
        case 'length': return { type, max_chars: int(o.max_chars, 0, 4000, 0), max_lines: int(o.max_lines, 0, 200, 0) };
        case 'zalgo': return { type, max: int(o.max, 3, 100, 8) };
        case 'repeated_chars': return { type, max: int(o.max, 3, 100, 10) };
        case 'channel_rate': return { type, messages: int(o.messages, 3, 200, 20), seconds: int(o.seconds, 2, 300, 10) };
        case 'mention_rate': return { type, mentions: int(o.mentions, 2, 200, 10), seconds: int(o.seconds, 2, 300, 10) };
        case 'attachment_rate': return { type, attachments: int(o.attachments, 2, 100, 6), seconds: int(o.seconds, 2, 300, 30) };
        case 'link_rate': return { type, links: int(o.links, 2, 100, 5), seconds: int(o.seconds, 2, 300, 30) };
        case 'name': {
            const match = oneOf(o.match, ['contains', 'word', 'exact', 'regex'], 'contains');
            if (match === 'regex' && !safeRegex(o.pattern))
                return null;
            return { type, where: oneOf(o.where, ['username', 'nickname', 'either'], 'either'), match, list_id: list, words: (0, exports.cleanWords)(o.words), pattern: match === 'regex' ? String(o.pattern) : '' };
        }
        case 'violations': return { type, name: (0, exports.counterName)(o.name), count: int(o.count, 1, 100, 4), minutes: int(o.minutes, 1, 1440, 60) };
        case 'heat': return { type, at_least: int(o.at_least, 1, 10000, 100) };
    }
    return null;
}
function cleanCondition(raw) {
    const o = asObject(raw);
    if (!exports.CONDITION_TYPES.includes(o.type))
        return null;
    const type = o.type;
    switch (type) {
        case 'channel':
        case 'category': return { type, mode: oneOf(o.mode, ['in', 'not_in'], 'not_in'), ids: ids(o.ids) };
        case 'role': return { type, mode: oneOf(o.mode, ['has_any', 'has_all', 'has_none'], 'has_none'), ids: ids(o.ids) };
        case 'account_age':
        case 'member_age': return { type, max_days: int(o.max_days, 1, 3650, 7) };
        case 'no_roles': return { type };
        case 'author_kind': return { type, kind: oneOf(o.kind, ['humans', 'bots'], 'humans') };
        case 'message_kind': return { type, kind: oneOf(o.kind, ['new', 'edited'], 'new') };
        case 'thread': return { type, mode: oneOf(o.mode, ['only', 'ignore'], 'ignore') };
    }
    return null;
}
function cleanEffect(raw) {
    const o = asObject(raw);
    if (!exports.EFFECT_TYPES.includes(o.type))
        return null;
    const type = o.type;
    switch (type) {
        case 'delete':
        case 'kick':
        case 'reset_heat':
        case 'quarantine': return { type };
        case 'reply': return { type, text: text(o.text, exports.LIMITS.text), delete_after: int(o.delete_after, 0, 600, 10) };
        case 'dm': return { type, text: text(o.text, exports.LIMITS.text) };
        case 'warn': return { type, reason: text(o.reason, 200) };
        case 'timeout': return { type, minutes: int(o.minutes, 1, 40320, 10), multiplier: int(o.multiplier, 1, 10, 1), max_minutes: int(o.max_minutes, 1, 40320, 40320), window_hours: int(o.window_hours, 1, 720, 168) };
        case 'ban': return { type, reason: text(o.reason, 200), delete_days: int(o.delete_days, 0, 7, 0) };
        case 'add_role':
        case 'remove_role': return SNOWFLAKE.test(String(o.role_id ?? '')) ? { type, role_id: String(o.role_id) } : null;
        case 'purge': return { type, count: int(o.count, 2, 100, 10), minutes: int(o.minutes, 1, 1440, 10) };
        case 'slowmode': return { type, seconds: int(o.seconds, 1, 21600, 10), minutes: int(o.minutes, 1, 1440, 10) };
        case 'alert': return { type, channel_id: channelOrNone(o.channel_id), text: text(o.text, exports.LIMITS.text) };
        case 'set_nickname': return { type, nickname: text(o.nickname, 32) };
        case 'temp_role': return SNOWFLAKE.test(String(o.role_id ?? '')) ? { type, role_id: String(o.role_id), minutes: int(o.minutes, 1, 43200, 60) } : null;
        case 'violation':
        case 'reset_violations': return { type, name: (0, exports.counterName)(o.name) };
        case 'add_heat': return { type, amount: int(o.amount, 1, 1000, 20) };
        case 'lockdown': return { type, minutes: int(o.minutes, 1, 720, 10) };
    }
    return null;
}
const cleanList = (raw, clean, max) => (Array.isArray(raw) ? raw.map(clean).filter((item) => item !== null).slice(0, max) : []);
/** A rule as the dashboard saves it, cleaned. A rule with nothing to look for or nothing to do is refused (`error`). */
function cleanRule(raw) {
    const o = asObject(raw);
    const name = text(o.name, exports.LIMITS.listName);
    if (!name)
        return { ok: false, error: 'name' };
    const triggers = cleanList(o.triggers, cleanTrigger, exports.LIMITS.triggers);
    if (!triggers.length)
        return { ok: false, error: 'triggers' };
    const effects = cleanList(o.effects, cleanEffect, exports.LIMITS.effects);
    if (!effects.length)
        return { ok: false, error: 'effects' };
    return {
        ok: true,
        rule: {
            name, enabled: o.enabled !== false, dry_run: o.dry_run === true, trigger_mode: oneOf(o.trigger_mode, ['any', 'all'], 'any'), triggers, effects,
            conditions: cleanList(o.conditions, cleanCondition, exports.LIMITS.conditions),
            threshold_count: int(o.threshold_count, 1, 50, 1), threshold_minutes: int(o.threshold_minutes, 1, 1440, 10), stop: o.stop !== false,
        },
    };
}
const cleanConditions = (raw) => cleanList(raw, cleanCondition, exports.LIMITS.conditions);
exports.cleanConditions = cleanConditions;
/** The memory of a rule that looks at several messages (`repeated`, `rate`...): timestamps by key, forgotten after their window. */
class Recent {
    seen = new Map();
    /** Writes one message and returns how many (or, with a `weight`, how much; with the same `key` when given) there are in the last `windowMs`. */
    add(id, now, windowMs, key, weight = 1) {
        const kept = (this.seen.get(id) ?? []).filter((entry) => now - entry.at <= windowMs);
        kept.push({ at: now, key: key ?? '', weight });
        this.seen.set(id, kept);
        return key === undefined ? kept.reduce((sum, entry) => sum + entry.weight, 0) : kept.filter((entry) => entry.key === key).length;
    }
    /** Forgets what is older than `maxAgeMs`, so the memory does not grow with every member who ever wrote. */
    sweep(now, maxAgeMs) {
        for (const [id, entries] of this.seen) {
            const kept = entries.filter((entry) => now - entry.at <= maxAgeMs);
            if (kept.length)
                this.seen.set(id, kept);
            else
                this.seen.delete(id);
        }
    }
    get size() { return this.seen.size; }
}
exports.Recent = Recent;
const EMOJI = /\p{Extended_Pictographic}|<a?:\w+:\d+>/gu;
const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const MARKS = /\p{M}/gu;
const isImage = (a) => /^image\//.test(a.contentType ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name);
// A matcher is built once for each trigger (the triggers live as long as the rules are cached), not for every message.
const matchers = new WeakMap();
function wordsOf(trigger, lists) {
    const list = typeof trigger.list_id === 'number' ? lists.words.get(trigger.list_id) ?? [] : [];
    return [...list, ...(trigger.words ?? [])];
}
function cachedMatcher(trigger, words, match) {
    let found = matchers.get(trigger);
    if (!found) {
        found = wordMatcher(words, match);
        matchers.set(trigger, found);
    }
    return found;
}
/** The name of what matched, for the log: the trigger and, when there is one, the word or the host. Null when it did not match. */
function matchTrigger(trigger, facts, lists, recent, keys, now) {
    const content = facts.content;
    switch (trigger.type) {
        case 'words': {
            const hit = cachedMatcher(trigger, wordsOf(trigger, lists), trigger.match ?? 'word')(content);
            return hit === null ? null : `words:${hit}`;
        }
        case 'regex': {
            const re = safeRegex(trigger.pattern);
            return re && re.test(content) ? 'regex' : null;
        }
        case 'links': {
            const hosts = linkHosts(content);
            const mode = trigger.mode ?? 'any';
            const list = typeof trigger.list_id === 'number' ? lists.domains.get(trigger.list_id) ?? [] : [];
            const domains = [...list, ...(trigger.domains ?? [])];
            if (mode === 'any')
                return hosts.length ? `links:${hosts[0]}` : null;
            if (mode === 'deny') {
                const lowered = content.toLowerCase();
                const hit = domains.find((domain) => hosts.some((host) => (0, exports.hostMatches)(host, domain)) || new RegExp(`(?<![a-z0-9.-])${escapeRegex(domain)}(?![a-z0-9-])`).test(lowered));
                return hit ? `links:${hit}` : null;
            }
            const outside = hosts.find((host) => !domains.some((domain) => (0, exports.hostMatches)(host, domain)));
            return outside ? `links:${outside}` : null;
        }
        case 'invites': return INVITE.test(content) ? 'invites' : null;
        case 'mentions': {
            const max = Number(trigger.max ?? 5);
            const kind = trigger.kind ?? 'any';
            const count = kind === 'users' ? facts.users : kind === 'roles' ? facts.roles : kind === 'everyone' ? (facts.everyone ? max + 1 : 0) : facts.users + facts.roles + (facts.everyone ? 1 : 0);
            return count > max ? `mentions:${count}` : null;
        }
        case 'caps': {
            const letters = content.replace(/[^\p{L}]/gu, '');
            if (letters.length < Number(trigger.min_length ?? 12))
                return null;
            const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
            return upper / letters.length * 100 >= Number(trigger.percent ?? 70) ? 'caps' : null;
        }
        case 'emojis': return (content.match(EMOJI)?.length ?? 0) > Number(trigger.max ?? 10) ? 'emojis' : null;
        case 'repeated': {
            if (facts.isEdit)
                return null; // an edit is not a new message: it does not count for the speed of the member
            const normalized = normalizeText(content).replace(/\s+/g, ' ').trim();
            if (!normalized)
                return null;
            const count = recent.add(`rep:${keys.user}`, now, Number(trigger.seconds ?? 30) * 1000, normalized);
            return count >= Number(trigger.times ?? 3) ? 'repeated' : null;
        }
        case 'rate': {
            if (facts.isEdit)
                return null; // an edit is not a new message: it does not count for the speed of the member
            const count = recent.add(`rate:${keys.user}`, now, Number(trigger.seconds ?? 8) * 1000);
            return count >= Number(trigger.messages ?? 6) ? 'rate' : null;
        }
        case 'channel_rate': {
            if (facts.isEdit)
                return null; // an edit is not a new message: it does not count for the speed of the member
            const count = recent.add(`crate:${keys.channel}`, now, Number(trigger.seconds ?? 10) * 1000);
            return count >= Number(trigger.messages ?? 20) ? 'channel_rate' : null;
        }
        case 'mention_rate': {
            if (facts.isEdit)
                return null; // an edit is not a new message: it does not count for the speed of the member
            const mentions = facts.users + facts.roles + (facts.everyone ? 1 : 0);
            if (!mentions)
                return null;
            const total = recent.add(`mrate:${keys.user}`, now, Number(trigger.seconds ?? 10) * 1000, undefined, mentions);
            return total >= Number(trigger.mentions ?? 10) ? `mention_rate:${total}` : null;
        }
        case 'attachment_rate': {
            if (facts.isEdit)
                return null; // an edit is not a new message: it does not count for the speed of the member
            if (!facts.attachments.length)
                return null;
            const total = recent.add(`arate:${keys.user}`, now, Number(trigger.seconds ?? 30) * 1000, undefined, facts.attachments.length);
            return total >= Number(trigger.attachments ?? 6) ? `attachment_rate:${total}` : null;
        }
        case 'link_rate': {
            if (facts.isEdit)
                return null; // an edit is not a new message: it does not count for the speed of the member
            const links = linkHosts(content).length;
            if (!links)
                return null;
            const total = recent.add(`lrate:${keys.user}`, now, Number(trigger.seconds ?? 30) * 1000, undefined, links);
            return total >= Number(trigger.links ?? 5) ? `link_rate:${total}` : null;
        }
        case 'attachments': {
            const kind = trigger.kind ?? 'any';
            const chosen = kind === 'images' ? facts.attachments.filter(isImage) : kind === 'files' ? facts.attachments.filter((a) => !isImage(a)) : facts.attachments;
            return chosen.length > Number(trigger.max ?? 0) ? `attachments:${chosen.length}` : null;
        }
        case 'length': {
            const chars = Number(trigger.max_chars ?? 0);
            const lines = Number(trigger.max_lines ?? 0);
            if (chars && content.length > chars)
                return 'length:chars';
            if (lines && content.split('\n').length > lines)
                return 'length:lines';
            return null;
        }
        case 'zalgo': return (content.match(MARKS)?.length ?? 0) >= Number(trigger.max ?? 8) ? 'zalgo' : null;
        case 'repeated_chars': {
            const max = Number(trigger.max ?? 10);
            return new RegExp(`(\\P{M}\\p{M}*)\\1{${max},}`, 'u').test(content) ? 'repeated_chars' : null;
        }
        case 'name': {
            const where = trigger.where ?? 'either';
            const names = [...(where === 'nickname' ? [] : [facts.username]), ...(where === 'username' ? [] : facts.nickname ? [facts.nickname] : [])];
            for (const name of names) {
                if (trigger.match === 'regex') {
                    const re = safeRegex(trigger.pattern);
                    if (re && re.test(name))
                        return 'name:regex';
                    continue;
                }
                const hit = cachedMatcher(trigger, wordsOf(trigger, lists), trigger.match ?? 'contains')(name);
                if (hit !== null)
                    return `name:${hit}`;
            }
            return null;
        }
        case 'violations': {
            const have = facts.extra.violations[`${trigger.name}|${trigger.minutes}`] ?? 0;
            return have >= Number(trigger.count ?? 4) ? `violations:${trigger.name}` : null;
        }
        case 'heat': return facts.extra.heat >= Number(trigger.at_least ?? 100) ? 'heat' : null;
    }
    return null;
}
/** Whether a condition holds for the message. Conditions with nothing chosen hold (an empty list does not block anybody). */
function checkCondition(condition, facts) {
    const list = condition.ids ?? [];
    switch (condition.type) {
        case 'channel': {
            const here = list.includes(facts.channelId) || (facts.parentId !== null && list.includes(facts.parentId));
            return !list.length || (condition.mode === 'in' ? here : !here);
        }
        case 'category': {
            const here = facts.categoryId !== null && list.includes(facts.categoryId);
            return !list.length || (condition.mode === 'in' ? here : !here);
        }
        case 'role': {
            if (!list.length)
                return true;
            if (condition.mode === 'has_all')
                return list.every((id) => facts.roleIds.has(id));
            const has = list.some((id) => facts.roleIds.has(id));
            return condition.mode === 'has_any' ? has : !has;
        }
        case 'account_age': return facts.accountAgeDays <= Number(condition.max_days ?? 7);
        case 'member_age': return facts.memberAgeDays <= Number(condition.max_days ?? 7);
        case 'no_roles': return facts.roleIds.size === 0;
        case 'author_kind': return condition.kind === 'bots' ? facts.isBot : !facts.isBot;
        case 'message_kind': return condition.kind === 'edited' ? facts.isEdit : !facts.isEdit;
        case 'thread': return condition.mode === 'only' ? facts.isThread : !facts.isThread;
    }
    return true;
}
const checkConditions = (conditions, facts) => conditions.every((condition) => checkCondition(condition, facts));
exports.checkConditions = checkConditions;
/** What matched, one entry per trigger that did (all of them when `trigger_mode` is `all`), or null when the rule does not apply. */
function evaluateRule(rule, facts, lists, recent, keys, now) {
    if (!(0, exports.checkConditions)(rule.conditions, facts))
        return null;
    const found = [];
    for (const trigger of rule.triggers) {
        const hit = matchTrigger(trigger, facts, lists, recent, keys, now);
        if (hit !== null)
            found.push(hit);
        else if (rule.trigger_mode === 'all')
            return null;
    }
    return found.length ? found : null;
}
/** The counters of violations and the heat a rule has to look at before it is evaluated: [name, minutes] of each `violations` trigger, and whether it has a `heat` trigger. */
function needsOf(rule) {
    const violations = [];
    let heat = false;
    for (const trigger of rule.triggers) {
        if (trigger.type === 'violations')
            violations.push({ name: String(trigger.name), minutes: Number(trigger.minutes) });
        if (trigger.type === 'heat')
            heat = true;
    }
    return { violations, heat };
}
/** How long a timeout lasts when it grows with each time (`multiplier`): the base, times the multiplier once for every time before, up to the maximum. */
function escalatedMinutes(base, multiplier, before, maxMinutes) {
    const factor = Math.pow(Math.max(1, multiplier), Math.max(0, before));
    return Math.max(1, Math.min(maxMinutes, Math.round(base * factor)));
}
/** The heat a member has now: what was saved, minus `decayPerMinute` for each minute since, never below 0. */
function decayedHeat(saved, savedAtMs, nowMs, decayPerMinute) {
    const minutes = Math.max(0, nowMs - savedAtMs) / 60_000;
    return Math.max(0, saved - minutes * Math.max(0, decayPerMinute));
}
/** The text of a reply or a message with {user}, {username}, {server}, {channel} and {rule} filled in. */
function fillText(template, values) {
    return template.replace(/\{(user|username|server|channel|rule)\}/g, (_all, key) => values[key] ?? '');
}
// ---- The join gate: what is looked at when somebody joins ----------------------------------------------------------------------------------------------
exports.GATE_ACTIONS = ['none', 'alert', 'timeout', 'kick', 'ban', 'quarantine'];
exports.RAID_ACTIONS = ['alert', 'lockdown', 'kick_new', 'ban_new'];
exports.DEFAULT_GATE = {
    enabled: false, no_avatar_action: 'none', account_age_days: 0, account_age_action: 'none', username_list_id: null, username_words: [], username_action: 'none',
    timeout_minutes: 60, raid_joins: 0, raid_seconds: 30, raid_action: 'alert', raid_lockdown_minutes: 10, raid_alert_channel_id: '',
};
function cleanJoinGate(raw) {
    const o = asObject(raw);
    return {
        enabled: o.enabled === true,
        no_avatar_action: oneOf(o.no_avatar_action, exports.GATE_ACTIONS, 'none'),
        account_age_days: int(o.account_age_days, 0, 365, 0), account_age_action: oneOf(o.account_age_action, exports.GATE_ACTIONS, 'none'),
        username_list_id: Number(o.username_list_id) > 0 ? Number(o.username_list_id) : null, username_words: (0, exports.cleanWords)(o.username_words), username_action: oneOf(o.username_action, exports.GATE_ACTIONS, 'none'),
        timeout_minutes: int(o.timeout_minutes, 1, 40320, 60),
        raid_joins: int(o.raid_joins, 0, 500, 0), raid_seconds: int(o.raid_seconds, 5, 600, 30), raid_action: oneOf(o.raid_action, exports.RAID_ACTIONS, 'alert'),
        raid_lockdown_minutes: int(o.raid_lockdown_minutes, 1, 720, 10), raid_alert_channel_id: channelOrNone(o.raid_alert_channel_id),
    };
}
/** What the gate finds in a member who joins: the reasons and the action of each (the strongest action is applied, all the reasons are logged). */
function gateFindings(gate, facts, usernameWords) {
    const found = [];
    if (!gate.enabled || facts.isBot)
        return found;
    if (gate.no_avatar_action !== 'none' && !facts.hasAvatar)
        found.push({ reason: 'no_avatar', action: gate.no_avatar_action });
    if (gate.account_age_action !== 'none' && gate.account_age_days > 0 && facts.accountAgeDays < gate.account_age_days)
        found.push({ reason: `account_age:${Math.floor(facts.accountAgeDays)}d`, action: gate.account_age_action });
    if (gate.username_action !== 'none' && usernameWords.length) {
        const hit = wordMatcher(usernameWords, 'contains')(`${facts.username} ${facts.displayName}`);
        if (hit)
            found.push({ reason: `username:${hit}`, action: gate.username_action });
    }
    return found;
}
const STRENGTH = { none: 0, alert: 1, quarantine: 2, timeout: 3, kick: 4, ban: 5 };
const strongestAction = (found) => found.reduce((best, f) => (STRENGTH[f.action] > STRENGTH[best] ? f.action : best), 'none');
exports.strongestAction = strongestAction;
