// The rules of a prefix of your own, apart from Discord and the database so they can be checked on their own.
const MAX_LENGTH = 5;

/** Returns the prefix cleaned up, or `{ error }` with what is wrong with it. */
function validateUserPrefix(input) {
  const value = String(input ?? '').trim();
  if (!value) return { error: 'Write the prefix you want.' };
  if (value.length > MAX_LENGTH) return { error: `A prefix is up to ${MAX_LENGTH} characters.` };
  if (/\s/.test(value)) return { error: 'A prefix cannot have spaces.' };
  if (/^[\p{L}\p{N}]+$/u.test(value)) return { error: 'Add a symbol to it (for example `.`, `?`, `p!` or `,`): a prefix of only letters or numbers would set Petto off in normal chat.' };
  if (value.startsWith('/')) return { error: 'It cannot start with `/`, that is for slash commands.' };
  if (/^<[@#:a]/.test(value) || value.includes('@')) return { error: 'It cannot be a mention.' };
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

const REASON_TEXT = {
  team: 'you are on the Petto team',
  premium: 'you have Petto Premium',
  booster: 'you boost the Petto support server',
  partner: 'you are a Petto partner',
  role: 'you have one of the special roles of the support server',
};

const REQUIREMENTS = [
  'boost the Petto support server',
  'have Petto Premium',
  'be a Petto partner (or have the partner role)',
  'be on the Petto team (staff, testers or developers)',
  'have one of the special roles of the support server',
];

module.exports = { MAX_LENGTH, validateUserPrefix, accessReasons, REASON_TEXT, REQUIREMENTS };
