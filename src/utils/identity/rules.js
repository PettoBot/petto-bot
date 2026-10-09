// Creating, changing and deleting Vanity and Server Tag rules. The commands and the dashboard both go through here, so a
// rule is checked the same way wherever it comes from. Every function answers `{ ok: true, ... }` or `{ ok: false, code, message }`
// with the codes the dashboard knows.
const db = require('../../db/identity');
const { validateVanityRule, validateGuildTagRule, matchVanity, DEFAULT_NORMALIZATION } = require('./compare');

const MAX_RULES = 50;
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

const fail = (code, message) => ({ ok: false, code, message });

function cleanName(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Whether the bot can hand out this role. `actor` (a guild member) is also checked: nobody can set up a rule for a role at or
 * above their own highest role, unless they own the server.
 */
function roleProblem(guild, roleId, actor = null) {
  const role = guild.roles.cache.get(String(roleId));
  if (!role || role.id === guild.id) return fail('role_not_found', 'That role does not exist in this server.');
  if (role.managed) return fail('role_managed', 'That role is managed by an integration and cannot be assigned.');
  const me = guild.members.me;
  if (!me || role.position >= me.roles.highest.position) return fail('role_above_bot', "Move Petto's role above that role in Server Settings, Roles.");
  if (actor && actor.id !== guild.ownerId && role.position >= actor.roles.highest.position) return fail('role_above_you', 'You can only use roles below your own highest role.');
  return null;
}

async function countRules(source, guildId) {
  const rules = source === 'vanity' ? await db.listVanityRules(guildId, { all: true }) : await db.listGuildTagRules(guildId, { all: true });
  return rules;
}

/** `input` has the fields of a rule (name, word/source/comparison or condition/value, role_id, action, enabled). */
async function createRule(guild, source, input, actor, actorId) {
  const name = cleanName(input.name);
  if (!NAME_PATTERN.test(name)) return fail('invalid_name', 'The name can have letters, numbers, - and _ (1 to 40 characters).');
  const rule = source === 'vanity'
    ? { name, word: String(input.word ?? '').trim(), source: input.source, comparison: input.comparison, role_id: input.role_id, action: input.action, enabled: input.enabled !== false, normalization: { ...DEFAULT_NORMALIZATION, ...(input.normalization ?? {}) } }
    : { name, condition: input.condition, value: String(input.value ?? '').trim(), role_id: input.role_id, action: input.action, enabled: input.enabled !== false };
  const problem = source === 'vanity' ? validateVanityRule(rule) : validateGuildTagRule(rule);
  if (problem) return fail('invalid_rule', problem);
  const role = roleProblem(guild, rule.role_id, actor);
  if (role) return role;
  const existing = await countRules(source, guild.id);
  if (existing.some((entry) => entry.name === name)) return fail('duplicate_name', 'A rule with that name already exists.');
  if (existing.length >= MAX_RULES) return fail('limit', `A server can have up to ${MAX_RULES} ${source === 'vanity' ? 'Vanity' : 'Server Tag'} rules.`);
  await db.createRule(source, guild.id, { ...rule, created_by: actorId ?? '' });
  return { ok: true, name };
}

/** `changes` only has the fields to change. The whole rule is validated after the change, so a pattern that does not compile is refused. */
async function updateRule(guild, source, name, changes, actor) {
  const rules = await countRules(source, guild.id);
  const current = rules.find((rule) => rule.name === cleanName(name));
  if (!current) return fail('rule_not_found', 'That rule does not exist anymore.');
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
    const problem = source === 'vanity' ? validateVanityRule(next) : validateGuildTagRule(next);
    if (problem) return fail('invalid_rule', problem);
    if (changed.role_id || changed.enabled === true) {
      const role = roleProblem(guild, next.role_id, changed.role_id ? actor : null);
      if (role) return role;
    }
  }
  await db.updateRule(source, guild.id, current.name, changed);
  return { ok: true, name: current.name };
}

async function removeRule(guild, source, name) {
  const removed = await db.deleteRule(source, guild.id, cleanName(name));
  return removed ? { ok: true } : fail('rule_not_found', 'That rule does not exist anymore.');
}

/** A short description of a rule for lists. */
function describeRule(source, rule) {
  const off = rule.enabled ? '' : ' _(off)_';
  const verb = rule.action === 'remove_role' ? 'removes' : 'adds';
  if (source === 'vanity') return `**${rule.name}**${off} · ${rule.source.replace(/_/g, ' ')} ${rule.comparison.replace(/_/g, ' ')} \`${rule.word}\` · ${verb} <@&${rule.role_id}>`;
  return `**${rule.name}**${off} · ${rule.condition.replace(/_/g, ' ')}${rule.value ? ` \`${rule.value}\`` : ''} · ${verb} <@&${rule.role_id}>`;
}

module.exports = { MAX_RULES, NAME_PATTERN, roleProblem, createRule, updateRule, removeRule, describeRule, cleanName, matchVanity };
