// How a Vanity or Server Tag rule decides that a member matches. Ported from the Vanity bot, same rules.
const { t, currentLanguage } = require('../../i18n');

const MAX_REGEX_LENGTH = 256;
const MAX_VALUE_LENGTH = 512;

const VANITY_SOURCES = ['custom_status', 'username', 'global_name', 'guild_nickname', 'display_name'];
const COMPARISONS = ['equals', 'contains', 'starts_with', 'ends_with', 'regex'];
const CONDITIONS = ['is_guild_id', 'is_not_guild_id', 'identity_enabled', 'identity_disabled', 'tag_equals', 'tag_not_equals'];
const ACTIONS = ['add_role', 'remove_role'];
const DEFAULT_NORMALIZATION = { case_fold: true, trim_space: true, collapse_space: true };

function normalize(value, options = DEFAULT_NORMALIZATION) {
  let text = String(value ?? '');
  if (options.trim_space) text = text.trim();
  if (options.collapse_space) text = text.replace(/\s+/gu, ' ');
  if (options.case_fold) text = text.toLowerCase();
  return text;
}

/** The name shown for the member: nickname, then global name, then the display name, then the username. */
function resolveDisplayName(member) {
  return member.guildNickname || member.globalName || member.displayName || member.username || '';
}

/** False when the value of a source could not be read right now (a Custom Status in a sweep that has no presence): unknown is not empty. */
function vanitySourceKnown(member, source) {
  return !member.unknownSources || !member.unknownSources.has(source);
}

function vanityValue(member, source) {
  switch (source) {
    case 'username': return member.username ?? '';
    case 'global_name': return member.globalName ?? '';
    case 'guild_nickname': return member.guildNickname ?? '';
    case 'display_name': return resolveDisplayName(member);
    case 'custom_status': return member.customStatus ?? '';
    default: return '';
  }
}

/** Whether the rule matches the member. Throws for a rule that cannot work (empty word, a pattern that does not compile, a value too long for a pattern). */
function matchVanity(rule, member, lang = currentLanguage()) {
  if (!rule.word) throw new Error(t(lang, 'identity.error.noWord', { name: rule.name }));
  const left = normalize(vanityValue(member, rule.source), rule.normalization);
  const right = normalize(rule.word, rule.normalization);
  switch (rule.comparison) {
    case 'equals': return left === right;
    case 'contains': return left.includes(right);
    case 'starts_with': return left.startsWith(right);
    case 'ends_with': return left.endsWith(right);
    case 'regex': {
      if ([...String(rule.word)].length > MAX_REGEX_LENGTH) throw new Error(t(lang, 'identity.error.patternTooLong', { name: rule.name, max: MAX_REGEX_LENGTH }));
      if ([...left].length > MAX_VALUE_LENGTH) throw new Error(t(lang, 'identity.error.valueTooLong', { name: rule.name, max: MAX_VALUE_LENGTH }));
      let expression;
      try { expression = new RegExp(right, 'u'); } catch (error) { throw new Error(t(lang, 'identity.error.patternInvalid', { name: rule.name, error: error.message })); }
      return expression.test(left);
    }
    default: throw new Error(t(lang, 'identity.error.comparison', { comparison: rule.comparison }));
  }
}

/** Server Tag rules. Without data from Discord nothing matches, not even the negative conditions. */
function matchGuildTag(rule, primary) {
  if (!primary) return false;
  const guildId = String(primary.identityGuildId ?? '').trim();
  const tag = String(primary.tag ?? '').trim();
  const value = String(rule.value ?? '');
  switch (rule.condition) {
    case 'is_guild_id': return guildId !== '' && guildId === value;
    case 'is_not_guild_id': return guildId !== '' && guildId !== value;
    case 'identity_enabled': return primary.identityEnabled === true;
    case 'identity_disabled': return primary.identityEnabled === false;
    case 'tag_equals': return tag !== '' && tag.toLowerCase() === value.toLowerCase();
    case 'tag_not_equals': return tag !== '' && tag.toLowerCase() !== value.toLowerCase();
    default: return false;
  }
}

function conditionNeedsValue(condition) {
  return ['is_guild_id', 'is_not_guild_id', 'tag_equals', 'tag_not_equals'].includes(condition);
}

/** A message for the first thing wrong with a Vanity rule, or null. Used by the commands and the dashboard alike. */
function validateVanityRule(rule, lang = currentLanguage()) {
  if (!String(rule.name ?? '').trim()) return t(lang, 'identity.validate.vanityName');
  if (!rule.word) return t(lang, 'identity.validate.word');
  if (!rule.role_id) return t(lang, 'identity.validate.role');
  if (!VANITY_SOURCES.includes(rule.source)) return t(lang, 'identity.validate.source');
  if (!COMPARISONS.includes(rule.comparison)) return t(lang, 'identity.validate.comparison');
  if (!ACTIONS.includes(rule.action)) return t(lang, 'identity.validate.action');
  try { matchVanity(rule, {}, lang); } catch (error) { return t(lang, 'identity.validate.invalid', { error: error.message }); }
  return null;
}

function validateGuildTagRule(rule, lang = currentLanguage()) {
  if (!String(rule.name ?? '').trim()) return t(lang, 'identity.validate.tagName');
  if (!rule.role_id) return t(lang, 'identity.validate.role');
  if (!CONDITIONS.includes(rule.condition)) return t(lang, 'identity.validate.condition');
  if (conditionNeedsValue(rule.condition) && !String(rule.value ?? '').trim()) return t(lang, 'identity.validate.conditionValue');
  if (!ACTIONS.includes(rule.action)) return t(lang, 'identity.validate.action');
  return null;
}

module.exports = {
  VANITY_SOURCES, COMPARISONS, CONDITIONS, ACTIONS, DEFAULT_NORMALIZATION,
  normalize, resolveDisplayName, vanitySourceKnown, vanityValue, matchVanity, matchGuildTag, conditionNeedsValue,
  validateVanityRule, validateGuildTagRule,
};
