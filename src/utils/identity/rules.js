// Creating, changing and deleting Vanity and Server Tag rules. The commands and the dashboard both go through here, so a
// rule is checked the same way wherever it comes from. Every function answers `{ ok: true, ... }` or `{ ok: false, code, message }`
// with the codes the dashboard knows.
const db = require('../../db/identity');
const { validateVanityRule, validateGuildTagRule, matchVanity, DEFAULT_NORMALIZATION } = require('./compare');
const { t, currentLanguage } = require('../../i18n');

const MAX_RULES = 50;
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

const fail = (code, message) => ({ ok: false, code, message });

// Spaces become dashes, so a name written as "vanity 2" is saved (and found again) as "vanity-2" instead of being refused.
function cleanName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Whether the bot can hand out this role. `actor` (a guild member) is also checked: nobody can set up a rule for a role at or
 * above their own highest role, unless they own the server.
 */
function roleProblem(guild, roleId, actor = null, lang = currentLanguage()) {
  const role = guild.roles.cache.get(String(roleId));
  if (!role || role.id === guild.id) return fail('role_not_found', t(lang, 'identity.rule.roleNotFound'));
  if (role.managed) return fail('role_managed', t(lang, 'identity.rule.roleManaged'));
  const me = guild.members.me;
  if (!me || role.position >= me.roles.highest.position) return fail('role_above_bot', t(lang, 'identity.rule.roleAboveBot'));
  if (actor && actor.id !== guild.ownerId && role.position >= actor.roles.highest.position) return fail('role_above_you', t(lang, 'identity.rule.roleAboveYou'));
  return null;
}

async function countRules(source, guildId) {
  const rules = source === 'vanity' ? await db.listVanityRules(guildId, { all: true }) : await db.listGuildTagRules(guildId, { all: true });
  return rules;
}

/** `input` has the fields of a rule (name, word/source/comparison or condition/value, role_id, action, enabled). */
async function createRule(guild, source, input, actor, actorId, lang = currentLanguage()) {
  const name = cleanName(input.name);
  if (!NAME_PATTERN.test(name)) return fail('invalid_name', t(lang, 'identity.rule.invalidName'));
  const rule = source === 'vanity'
    ? { name, word: String(input.word ?? '').trim(), source: input.source, comparison: input.comparison, role_id: input.role_id, action: input.action, enabled: input.enabled !== false, normalization: { ...DEFAULT_NORMALIZATION, ...(input.normalization ?? {}) } }
    : { name, condition: input.condition, value: String(input.value ?? '').trim(), role_id: input.role_id, action: input.action, enabled: input.enabled !== false };
  const problem = source === 'vanity' ? validateVanityRule(rule, lang) : validateGuildTagRule(rule, lang);
  if (problem) return fail('invalid_rule', problem);
  const role = roleProblem(guild, rule.role_id, actor, lang);
  if (role) return role;
  const existing = await countRules(source, guild.id);
  if (existing.some((entry) => entry.name === name)) return fail('duplicate_name', t(lang, 'identity.rule.duplicate'));
  if (existing.length >= MAX_RULES) return fail('limit', t(lang, source === 'vanity' ? 'identity.rule.limit.vanity' : 'identity.rule.limit.guildtag', { max: MAX_RULES }));
  await db.createRule(source, guild.id, { ...rule, created_by: actorId ?? '' });
  return { ok: true, name };
}

/** `changes` only has the fields to change. The whole rule is validated after the change, so a pattern that does not compile is refused. */
async function updateRule(guild, source, name, changes, actor, lang = currentLanguage()) {
  const rules = await countRules(source, guild.id);
  const current = rules.find((rule) => rule.name === cleanName(name));
  if (!current) return fail('rule_not_found', t(lang, 'identity.rule.notFound'));
  const next = { ...current };
  const fields = source === 'vanity' ? ['word', 'source', 'comparison', 'role_id', 'enabled', 'action'] : ['condition', 'value', 'role_id', 'enabled', 'action'];
  const changed = {};
  for (const field of fields) {
    if (changes[field] === undefined || changes[field] === null || changes[field] === current[field]) continue;
    next[field] = typeof changes[field] === 'string' ? changes[field].trim() : changes[field];
    changed[field] = next[field];
  }
  if (!Object.keys(changed).length) return { ok: true, name: current.name, unchanged: true };
  // Turning a rule off always works, even when its role can no longer be assigned.
  const turningOff = Object.keys(changed).length === 1 && changed.enabled === false;
  if (!turningOff) {
    const problem = source === 'vanity' ? validateVanityRule(next, lang) : validateGuildTagRule(next, lang);
    if (problem) return fail('invalid_rule', problem);
    if (changed.role_id || changed.enabled === true) {
      const role = roleProblem(guild, next.role_id, changed.role_id ? actor : null, lang);
      if (role) return role;
    }
  }
  await db.updateRule(source, guild.id, current.name, changed);
  return { ok: true, name: current.name };
}

async function removeRule(guild, source, name, lang = currentLanguage()) {
  const removed = await db.deleteRule(source, guild.id, cleanName(name));
  return removed ? { ok: true } : fail('rule_not_found', t(lang, 'identity.rule.notFound'));
}

// The words for the stored values of a rule (`custom_status`, `starts_with`, `is_guild_id`...), in lists and tests.
const camel = (value) => String(value).replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());

/** The name of a source, comparison or condition (`kind`: 'source', 'comparison' or 'condition') in `lang`. */
function valueLabel(kind, value, lang = currentLanguage()) {
  const key = `identity.label.${kind}.${camel(value)}`;
  const text = t(lang, key);
  return text === key ? String(value).replace(/_/g, ' ') : text;
}

/** ' _(off)_' after the name of a rule that is turned off, nothing for one that is on. */
function offMark(rule, lang = currentLanguage()) {
  return rule.enabled ? '' : t(lang, 'identity.rule.off');
}

/** A short description of a rule for lists. */
function describeRule(source, rule, lang = currentLanguage()) {
  const off = offMark(rule, lang);
  const verb = rule.action === 'remove_role' ? 'remove' : 'add';
  const role = `<@&${rule.role_id}>`;
  if (source === 'vanity') return t(lang, `identity.rule.describe.vanity.${verb}`, { name: rule.name, off, source: valueLabel('source', rule.source, lang), comparison: valueLabel('comparison', rule.comparison, lang), word: rule.word, role });
  return t(lang, `identity.rule.describe.guildtag.${verb}`, { name: rule.name, off, condition: valueLabel('condition', rule.condition, lang), value: rule.value ? ` \`${rule.value}\`` : '', role });
}

module.exports = { MAX_RULES, NAME_PATTERN, roleProblem, createRule, updateRule, removeRule, describeRule, valueLabel, offMark, cleanName, matchVanity };
