// The replies of the partner module. A server can change each one: with plain text (with variables) or with one of its
// saved embeds. A missing or broken one gives the default text, so a bad setting never leaves the member without an answer.
const { resolve } = require('./embedVariables');
const { formatSpan, cooldownMinutes } = require('./partnerEngine');
const { templatePayload } = require('./templatedMessage');
const { plainCard, TONES } = require('./plainCard');

const { t, formatNumber, currentLanguage } = require('../i18n');

const RESPONSE_KEYS = ['completed', 'cooldown', 'invalid_invite', 'member_requirement', 'blacklisted', 'self_partner', 'age_requirement', 'nsfw_blocked', 'keyword_blocked', 'manager_welcome'];
const camel = (key) => key.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());

/** The name of a response, shown to the staff. */
const labelOf = (key, lang = currentLanguage()) => t(lang, `partners.label.${camel(key)}`);
/** The text of a response when the server did not change it. */
const defaultText = (key, lang = currentLanguage()) => t(lang, `partners.default.${camel(key)}`);

// In English: the choices of the slash command builder are named with the labels.
const LABELS = Object.fromEntries(RESPONSE_KEYS.map((key) => [key, labelOf(key, 'en')]));
const DEFAULTS = Object.fromEntries(RESPONSE_KEYS.map((key) => [key, defaultText(key, 'en')]));

const MAX_TEXT = 2000;

// The color of the card of each reply: green when it counts or welcomes, yellow when there is a wait or a number missing, red when the answer is no.
const COLORS = {
  completed: TONES.green, manager_welcome: TONES.green,
  cooldown: TONES.yellow, member_requirement: TONES.yellow, age_requirement: TONES.yellow,
  invalid_invite: TONES.red, blacklisted: TONES.red, self_partner: TONES.red, nsfw_blocked: TONES.red, keyword_blocked: TONES.red,
};

/** The words of a saved response: its text, or the default. */
function textOf(config, key, lang = currentLanguage()) {
  const saved = config?.messages?.[key];
  const text = typeof saved?.text === 'string' ? saved.text.trim() : '';
  return text ? text.slice(0, MAX_TEXT) : defaultText(key, lang);
}

/** What `{partner.*}` gives. `info` is `{ name, id, members, invite, managerId, managerName, counts, standings, config, cooldownEndsUnix }`. */
function partnerContext(info, lang = currentLanguage()) {
  const counts = info.counts ?? {};
  const stand = info.standings ?? {};
  return {
    name: info.name ?? '',
    id: info.id ?? '',
    members: info.members != null ? formatNumber(lang, Number(info.members)) : '',
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
    cooldown: info.config ? formatSpan(cooldownMinutes(info.config), lang) : '',
    rank_week: stand.rankWeek != null ? String(stand.rankWeek) : '',
    rank_total: stand.rankTotal != null ? String(stand.rankTotal) : '',
    top_week: stand.topWeek ? `<@${stand.topWeek.managerId}>` : '',
    top_week_count: stand.topWeek ? String(stand.topWeek.count) : '',
    top_total: stand.topTotal ? `<@${stand.topTotal.managerId}>` : '',
    top_total_count: stand.topTotal ? String(stand.topTotal.count) : '',
    server_day: String(stand.serverDay ?? 0),
    server_week: String(stand.serverWeek ?? 0),
    server_total: String(stand.serverTotal ?? 0),
  };
}

/** `{ components, flags, ... }` (or what a saved design gives) to send for one response, never empty. `ctx` has `member`/`user`/`guild` and `partner`. */
async function responsePayload(guildId, config, key, ctx, lang = currentLanguage()) {
  // The partner manager that the message is about is really pinged (a mention with `{user.mention}`); nobody else is, so the names in a
  // top list and anything else a message writes stay plain text.
  const manager = ctx.user?.id ?? ctx.member?.id ?? null;
  const allowedMentions = manager ? { parse: [], users: [manager] } : { parse: [] };
  const saved = config?.messages?.[key];
  if (saved?.template) {
    const payload = await templatePayload(guildId, saved.template, ctx);
    if (payload) return { ...payload, allowedMentions };
  }
  const content = (await resolve(textOf(config, key, lang), ctx)).slice(0, MAX_TEXT);
  // The usual look is a card; the text keeps its variables and its one real mention.
  return { ...plainCard(content || defaultText(key, lang), COLORS[key] ?? null), allowedMentions };
}

module.exports = { RESPONSE_KEYS, LABELS, DEFAULTS, MAX_TEXT, labelOf, defaultText, textOf, partnerContext, responsePayload };
