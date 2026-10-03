// The replies of the partner module. A server can change each one: with plain text (with variables) or with one of its
// saved embeds. A missing or broken one gives the default text, so a bad setting never leaves the member without an answer.
const { resolve } = require('./embedVariables');
const { templatePayload } = require('./templatedMessage');

const RESPONSE_KEYS = ['completed', 'cooldown', 'invalid_invite', 'member_requirement', 'blacklisted', 'self_partner', 'age_requirement', 'manager_welcome'];

const LABELS = {
  completed: 'Partnership completed',
  cooldown: 'Partner cooldown',
  invalid_invite: 'Invalid invite',
  member_requirement: 'Member requirement',
  blacklisted: 'Partner blacklist',
  self_partner: 'Self partner',
  age_requirement: 'Partner age requirement',
  manager_welcome: 'Partner Manager welcome',
};

const DEFAULTS = {
  completed: '{partner.manager} thanks for the partnership with **{partner.name}**! You have {partner.count_total} in total ({partner.count_week} this week).',
  cooldown: '{user.mention} you partnered with **{partner.name}** recently. You can do it again {partner.cooldown_ends}.',
  invalid_invite: '{user.mention} that invite is not valid or has expired.',
  member_requirement: '{user.mention} **{partner.name}** has {partner.members} members and at least {partner.min_members} are needed.',
  blacklisted: '{user.mention} that server is not allowed as a partner.',
  self_partner: '{user.mention} that invite is for this same server.',
  age_requirement: '{user.mention} **{partner.name}** is too new: it has to be at least {partner.min_age_days} days old.',
  manager_welcome: 'Welcome to the team, {user.mention}! Post the invite of a partner server in a partner channel and I will count it.',
};

const MAX_TEXT = 2000;

/** The words of a saved response: its text, or the default. */
function textOf(config, key) {
  const saved = config?.messages?.[key];
  const text = typeof saved?.text === 'string' ? saved.text.trim() : '';
  return text ? text.slice(0, MAX_TEXT) : DEFAULTS[key];
}

/** What `{partner.*}` gives. `info` is `{ name, id, members, invite, managerId, managerName, counts, config, cooldownEndsUnix }`. */
function partnerContext(info) {
  const counts = info.counts ?? {};
  return {
    name: info.name ?? '',
    id: info.id ?? '',
    members: info.members != null ? Number(info.members).toLocaleString('en-US') : '',
    invite: info.invite ?? '',
    manager: info.managerId ? `<@${info.managerId}>` : '',
    manager_name: info.managerName ?? '',
    count_day: String(counts.day ?? 0),
    count_week: String(counts.week ?? 0),
    count_total: String(counts.total ?? 0),
    min_members: String(info.config?.min_members ?? 0),
    min_age_days: String(info.config?.min_age_days ?? 0),
    cooldown_days: String(info.config?.cooldown_days ?? 0),
    cooldown_ends: info.cooldownEndsUnix ? `<t:${info.cooldownEndsUnix}:R>` : '',
  };
}

/** `{ content, embeds, components, ... }` to send for one response, never empty. `ctx` has `member`/`user`/`guild` and `partner`. */
async function responsePayload(guildId, config, key, ctx) {
  const saved = config?.messages?.[key];
  if (saved?.template) {
    const payload = await templatePayload(guildId, saved.template, ctx);
    if (payload) return { ...payload, allowedMentions: { parse: [] } };
  }
  const content = (await resolve(textOf(config, key), ctx)).slice(0, MAX_TEXT);
  return { content: content || DEFAULTS[key], allowedMentions: { parse: [] } };
}

module.exports = { RESPONSE_KEYS, LABELS, DEFAULTS, MAX_TEXT, textOf, partnerContext, responsePayload };
