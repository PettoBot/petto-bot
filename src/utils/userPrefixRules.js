// The rules of a prefix of your own, apart from Discord and the database so they can be checked on their own.
const { t, currentLanguage } = require('../i18n');

const MAX_LENGTH = 5;

/** Returns the prefix cleaned up, or `{ error }` with what is wrong with it (in `lang`). */
function validateUserPrefix(input, lang = currentLanguage()) {
  const value = String(input ?? '').trim();
  if (!value) return { error: t(lang, 'utility.myprefix.invalid.empty') };
  if (value.length > MAX_LENGTH) return { error: t(lang, 'utility.myprefix.invalid.tooLong', { max: MAX_LENGTH }) };
  if (/\s/.test(value)) return { error: t(lang, 'utility.myprefix.invalid.spaces') };
  if (/^[\p{L}\p{N}]+$/u.test(value)) return { error: t(lang, 'utility.myprefix.invalid.noSymbol') };
  if (value.startsWith('/')) return { error: t(lang, 'utility.myprefix.invalid.slash') };
  if (/^<[@#:a]/.test(value) || value.includes('@')) return { error: t(lang, 'utility.myprefix.invalid.mention') };
  return { prefix: value };
}

/**
 * Why someone may have a prefix of their own. `facts`: `team`, `premium` (booleans), and `member` (their member in the
 * support server, or null): `{ boosting, roleIds }`. `config`: `partnerRoleIds`, `userPrefixRoleIds`, `premiumRoleIds` (an object).
 * Returns the list of reasons; empty means no.
 */
function accessReasons({ team = false, premium = false, member = null }, config = {}) {
  const reasons = [];
  if (team) reasons.push('team');
  const roles = new Set(member?.roleIds ?? []);
  const has = (list) => (list ?? []).some((id) => roles.has(String(id)));
  if (premium || has(Object.values(config.premiumRoleIds ?? {}))) reasons.push('premium');
  if (member?.boosting) reasons.push('booster');
  if (has(config.partnerRoleIds)) reasons.push('partner');
  if (has(config.userPrefixRoleIds)) reasons.push('role');
  return reasons;
}

/** Why this person may have a prefix of their own, as words that follow "because" (`reason` is one of accessReasons). */
function reasonText(reason, lang = currentLanguage()) {
  return t(lang, `utility.myprefix.reason.${reason}`);
}

// What it takes to have a prefix of your own, one line each: `utility.myprefix.requirement.<name>`.
const REQUIREMENTS = ['booster', 'premium', 'partner', 'team', 'role'];

/** The requirements, written in `lang`. */
function requirementLines(lang = currentLanguage()) {
  return REQUIREMENTS.map((name) => t(lang, `utility.myprefix.requirement.${name}`));
}

module.exports = { MAX_LENGTH, validateUserPrefix, accessReasons, reasonText, requirementLines };
