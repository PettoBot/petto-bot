// The extra `{quest.*}` variables: every Discord timestamp style for the start and the end of a quest (they show in the reader's own
// time zone), the same moments written in plain words ("2 days ago", "in 5 hours", "now") for the places where Discord does not draw
// a timestamp (titles, footers, author names), and some more details of the rewards, the task and the countries.
const { discordTimestamp, TIMESTAMP_STYLES } = require('./when');
const { REWARD_KIND_LIST, REWARD_LABELS } = require('./questApi');

const REWARD_SLOTS = 3;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

const STYLE_DESCRIPTIONS = {
  relative: 'relative, such as "2 days ago" or "in 5 hours" (it keeps updating)',
  short_time: 'time, such as 5:00 PM',
  long_time: 'time with seconds, such as 5:00:30 PM',
  short_date: 'short date, such as 10/01/2026',
  long_date: 'long date, such as October 1, 2026',
  full: 'date and time, such as October 1, 2026 5:00 PM',
  full_long: 'weekday, date and time',
  short_datetime: 'short date and short time',
  medium_datetime: 'short date and time with seconds',
  unix: 'the unix time in seconds, for your own style: <t:{quest.starts.unix}:R>',
};
const STYLES = Object.keys(STYLE_DESCRIPTIONS);

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "2 days ago", "in 5 hours", "now": one unit, rounded down. */
function relativeText(ms, now = Date.now()) {
  const diff = ms - now;
  const size = Math.abs(diff);
  if (size < MINUTE) return 'now';
  const [n, unit] = size >= DAY ? [Math.floor(size / DAY), 'day'] : size >= HOUR ? [Math.floor(size / HOUR), 'hour'] : [Math.floor(size / MINUTE), 'minute'];
  return diff < 0 ? `${plural(n, unit)} ago` : `in ${plural(n, unit)}`;
}

/** "5 days 3 hours": the two biggest units of a length of time. Empty for zero or less. */
function spanText(ms) {
  if (!(ms >= MINUTE)) return '';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  const parts = [];
  if (days) parts.push(plural(days, 'day'));
  if (hours) parts.push(plural(hours, 'hour'));
  if (!days && minutes) parts.push(plural(minutes, 'minute'));
  return parts.slice(0, 2).join(' ');
}

const dateText = (date) => date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeText = (date) => `${date.toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} UTC`;
const seconds = (value) => (value >= 120 ? `${Math.round(value / 60)} min` : value ? `${value} s` : '');

/** The extra variables of a quest, by name (`starts.relative`, `expires_in`...). `now` is only for tests. */
function questExtras(quest, now = Date.now()) {
  const out = {};
  for (const [label, date] of [['starts', quest.startsAt], ['expires', quest.expiresAt]]) {
    for (const style of STYLES) out[`${label}.${style}`] = style === 'unix' ? String(Math.floor(date.getTime() / 1000)) : discordTimestamp(date.getTime(), style);
  }
  const left = quest.expiresAt.getTime() - now;
  Object.assign(out, {
    starts_ago: relativeText(quest.startsAt.getTime(), now),
    expires_in: left > 0 ? relativeText(quest.expiresAt.getTime(), now) : `ended ${relativeText(quest.expiresAt.getTime(), now)}`.replace('ended now', 'ended just now'),
    starts_date: dateText(quest.startsAt),
    expires_date: dateText(quest.expiresAt),
    starts_datetime: dateTimeText(quest.startsAt),
    expires_datetime: dateTimeText(quest.expiresAt),
    duration: spanText(quest.expiresAt - quest.startsAt),
    time_left: left > 0 ? spanText(left) || 'less than a minute' : 'Ended',
    days_left: String(Math.max(0, Math.floor(left / DAY))),
    hours_left: String(Math.max(0, Math.floor(left / HOUR))),
  });
  const first = quest.rewards[0];
  const expiring = quest.rewards.find((reward) => reward.expiresAt);
  const task = quest.tasks[0];
  Object.assign(out, {
    reward_name: first?.name ?? '',
    rewards_count: String(quest.rewards.length),
    reward_nitro_amount: String(quest.rewards.find((reward) => reward.premiumAmount)?.premiumAmount ?? ''),
    reward_expires: expiring ? discordTimestamp(expiring.expiresAt.getTime(), 'R') : '',
    task_type: task?.kind ?? '',
    task_seconds: task?.seconds ? String(task.seconds) : '',
    task_time: seconds(task?.seconds ?? 0),
    countries: quest.regions.include.join(', '),
    excluded_countries: quest.regions.exclude.join(', '),
  });
  // The reward of each kind and the first three rewards, so a design for decorations can show the decoration even when the Orbs come first.
  const rewardFields = (prefix, reward) => {
    out[`${prefix}.name`] = reward?.name ?? '';
    out[`${prefix}.type`] = reward ? (REWARD_LABELS[reward.kind] ?? 'Reward') : '';
    out[`${prefix}.image`] = reward?.image ?? '';
    out[`${prefix}.amount`] = reward?.kind === 'orbs' ? String(reward.amount) : '';
    out[`${prefix}.nitro_amount`] = reward?.premiumAmount ? String(reward.premiumAmount) : '';
    out[`${prefix}.expires`] = reward?.expiresAt ? discordTimestamp(reward.expiresAt.getTime(), 'R') : '';
  };
  for (const kind of REWARD_KIND_LIST) rewardFields(kind, quest.rewards.find((reward) => reward.kind === kind));
  for (let n = 1; n <= REWARD_SLOTS; n += 1) rewardFields(`reward${n}`, quest.rewards[n - 1]);
  out.reward_types = [...new Set(quest.rewards.map((reward) => REWARD_LABELS[reward.kind] ?? 'Reward'))].join(', ');
  return out;
}

/** The names and meaning of the extra variables, for the lists in the dashboard and the docs. */
const QUEST_EXTRA_VARS = [
  ...['starts', 'expires'].flatMap((label) => STYLES.map((style) => ({ key: `${label}.${style}`, desc: `When it ${label === 'starts' ? 'starts' : 'ends'}, as ${STYLE_DESCRIPTIONS[style]}` }))),
  { key: 'starts_ago', desc: 'When it started in plain words, such as 2 days ago, in 3 hours or now (works in titles and footers)' },
  { key: 'expires_in', desc: 'When it ends in plain words, such as in 5 days, or ended 1 day ago (works in titles and footers)' },
  { key: 'starts_date', desc: 'Start date in plain text, such as Oct 1, 2026 (UTC)' },
  { key: 'expires_date', desc: 'End date in plain text, such as Oct 8, 2026 (UTC)' },
  { key: 'starts_datetime', desc: 'Start date and time in plain text, in UTC' },
  { key: 'expires_datetime', desc: 'End date and time in plain text, in UTC' },
  { key: 'duration', desc: 'How long the quest lasts, such as 7 days' },
  { key: 'time_left', desc: 'How long is left, such as 5 days 3 hours, or Ended' },
  { key: 'days_left', desc: 'Whole days left, as a number' },
  { key: 'hours_left', desc: 'Whole hours left, as a number' },
  { key: 'reward_name', desc: 'Name of the first reward' },
  { key: 'rewards_count', desc: 'How many rewards it has' },
  { key: 'reward_nitro_amount', desc: 'Orbs a Nitro member gets, empty if none' },
  { key: 'reward_expires', desc: 'When the first reward that expires does so, as a relative time, empty if none' },
  { key: 'task_type', desc: 'Kind of the first task: video, play, stream or activity' },
  { key: 'task_seconds', desc: 'Seconds the first task takes' },
  { key: 'task_time', desc: 'Time of the first task, such as 2 min' },
  { key: 'countries', desc: 'Country codes it is only for, empty if none' },
  { key: 'excluded_countries', desc: 'Country codes where it is not available, empty if none' },
];
const FIELD_DESCRIPTIONS = { name: 'name', type: 'type (Virtual currency, Collectible, Code...)', image: 'picture, empty if none', amount: 'number of Orbs, empty if it is not Orbs', nitro_amount: 'Orbs a Nitro member gets, empty if none', expires: 'when it expires, as a relative time, empty if never' };
for (const kind of REWARD_KIND_LIST) for (const [field, text] of Object.entries(FIELD_DESCRIPTIONS)) QUEST_EXTRA_VARS.push({ key: `${kind}.${field}`, desc: `The ${kind} reward of the quest: its ${text}. Empty when the quest has none` });
for (let n = 1; n <= REWARD_SLOTS; n += 1) for (const [field, text] of Object.entries(FIELD_DESCRIPTIONS)) QUEST_EXTRA_VARS.push({ key: `reward${n}.${field}`, desc: `Reward number ${n}: its ${text}. Empty when there is none` });
QUEST_EXTRA_VARS.push({ key: 'reward_types', desc: 'The kinds of reward of the quest, such as Virtual currency, Collectible' });
const QUEST_EXTRA_KEYS = QUEST_EXTRA_VARS.map((entry) => entry.key);

module.exports = { QUEST_EXTRA_KEYS, QUEST_EXTRA_VARS, questExtras, relativeText, spanText, TIMESTAMP_STYLES };
