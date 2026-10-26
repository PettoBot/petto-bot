// The numbers behind `!stats`: a period set against the one before it, the busiest hours of the week, the top channels and members with their
// share, how the server grows and how long the members who left had stayed, how messages are made, and what one member did. It gets the counters
// as rows and has no database, so it can be tested. Days are those of Colombia (GMT-5), as everywhere in Petto.
const { botDay } = require('./botTime');
const { daysList } = require('./activitySummary');

const DAY_MS = 86_400_000;
const dayKey = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const num = (value) => Number(value ?? 0) || 0;
const sum = (values) => values.reduce((a, b) => a + b, 0);
const weekdayOf = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
const LIFESPAN_BUCKETS = 5;

/** The change from `before` to `now` as a percent, or null when there is nothing before to compare with. */
function percentChange(now, before) {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/** The days of the period and of the one before it, oldest first. */
function windows(days, now = new Date()) {
  return { current: daysList(days, now), previous: daysList(days, new Date(now.getTime() - days * DAY_MS)) };
}

/** A per-day series for each window, from rows with a `day` and some counters. */
function seriesOf(rows, window, pick) {
  const index = new Map(window.map((day, i) => [day, i]));
  const values = window.map(() => 0);
  for (const row of rows) {
    const i = index.get(dayKey(row.day));
    if (i !== undefined) values[i] += pick(row);
  }
  return values;
}

/** Top rows of a map by a key with their share of the total, leaving out those with nothing. */
function ranked(map, key, limit) {
  const total = sum([...map.values()].map((value) => value[key]));
  return [...map.entries()]
    .map(([id, value]) => ({ id, ...value, share: total ? value[key] / total : 0 }))
    .filter((row) => row[key] > 0)
    .sort((a, b) => b[key] - a[key] || b.messages - a.messages)
    .slice(0, limit);
}

/**
 * Everything `!stats` shows for a server. `memberTotal` (the members now) lets the growth line count members, not only changes.
 * Rows are as the database gives them: channelRows (channel_id, day, messages, reactions, voice_seconds), hourlyRows (day, hour, messages,
 * voice_seconds), flowRows (day, joins, leaves, invited), contentRows (day, links, attachments, replies, mentions) and lifespanRows (day, bucket,
 * members). They may span two periods: what lies outside both is ignored. What is per member comes already added up by the database, so a big
 * server does not send a row for every member and day: `memberDaily` (day, active: members with some activity that day), `memberTotals` (user_id,
 * messages, voice_seconds, active_days: the period) and `activeDistinct` ({ current, previous }: different members active in each period).
 */
function buildStatsV2({ days = 7, now = new Date(), channelRows = [], hourlyRows = [], flowRows = [], memberDaily = [], memberTotals = [], activeDistinct = null, contentRows = [], lifespanRows = [], memberTotal = null } = {}) {
  const { current, previous } = windows(days, now);
  const inCurrent = new Set(current);
  const inPrevious = new Set(previous);
  const only = (rows, set) => rows.filter((row) => set.has(dayKey(row.day)));

  const periodOf = (window, set) => {
    const channels = only(channelRows, set);
    const flows = only(flowRows, set);
    const messages = seriesOf(channels, window, (row) => num(row.messages));
    const voice = seriesOf(channels, window, (row) => num(row.voice_seconds));
    const reactions = seriesOf(channels, window, (row) => num(row.reactions));
    const joins = seriesOf(flows, window, (row) => num(row.joins));
    const leaves = seriesOf(flows, window, (row) => num(row.leaves));
    // Members with some activity each day (and, from the database, the different ones over the whole period).
    const activeMembers = seriesOf(only(memberDaily, set), window, (row) => num(row.active));
    const content = only(contentRows, set);
    return {
      days: window,
      series: { messages, voice, reactions, joins, leaves, net: joins.map((value, i) => value - leaves[i]), activeMembers },
      totals: {
        messages: sum(messages), reactions: sum(reactions), voiceSeconds: sum(voice), joins: sum(joins), leaves: sum(leaves),
        net: sum(joins) - sum(leaves), activeMembers: Math.max(...activeMembers, 0),
        perDay: window.length ? sum(messages) / window.length : 0,
        activeChannels: new Set(channels.filter((row) => num(row.messages) || num(row.voice_seconds)).map((row) => row.channel_id)).size,
        links: sum(content.map((row) => num(row.links))), attachments: sum(content.map((row) => num(row.attachments))),
        replies: sum(content.map((row) => num(row.replies))), mentions: sum(content.map((row) => num(row.mentions))),
      },
    };
  };

  const now_ = periodOf(current, inCurrent);
  const before = periodOf(previous, inPrevious);
  if (activeDistinct) {
    now_.totals.activeMembers = num(activeDistinct.current);
    before.totals.activeMembers = num(activeDistinct.previous);
  }
  const change = {};
  for (const key of Object.keys(now_.totals)) change[key] = percentChange(now_.totals[key], before.totals[key]);

  // The week by hour: messages (and voice seconds) of every hour of every weekday of the period.
  const heatmap = { messages: Array.from({ length: 7 }, () => Array(24).fill(0)), voice: Array.from({ length: 7 }, () => Array(24).fill(0)) };
  for (const row of only(hourlyRows, inCurrent)) {
    const weekday = weekdayOf(dayKey(row.day));
    const hour = Math.max(0, Math.min(23, num(row.hour)));
    heatmap.messages[weekday][hour] += num(row.messages);
    heatmap.voice[weekday][hour] += num(row.voice_seconds);
  }
  let best = null;
  heatmap.messages.forEach((hours, weekday) => hours.forEach((value, hour) => { if (value > 0 && (!best || value > best.value)) best = { weekday, hour, value }; }));
  const byHour = Array(24).fill(0);
  const byWeekday = Array(7).fill(0);
  heatmap.messages.forEach((hours, weekday) => hours.forEach((value, hour) => { byHour[hour] += value; byWeekday[weekday] += value; }));
  // The day split in four, as a share of the messages: night 0-5, morning 6-11, afternoon 12-17, evening 18-23.
  const totalByHour = sum(byHour);
  const dayparts = [0, 6, 12, 18].map((from) => (totalByHour ? sum(byHour.slice(from, from + 6)) / totalByHour : 0));

  const channels = new Map();
  for (const row of only(channelRows, inCurrent)) {
    const entry = channels.get(row.channel_id) ?? { messages: 0, voiceSeconds: 0, reactions: 0 };
    entry.messages += num(row.messages);
    entry.voiceSeconds += num(row.voice_seconds);
    entry.reactions += num(row.reactions);
    channels.set(row.channel_id, entry);
  }

  const members = new Map();
  for (const row of memberTotals) members.set(row.user_id, { messages: num(row.messages), voiceSeconds: num(row.voice_seconds), activeDays: num(row.active_days) });
  const withMessages = [...members.values()].filter((entry) => entry.messages > 0).map((entry) => entry.messages).sort((a, b) => b - a);
  const messagesTotal = sum(withMessages);
  const topTenth = Math.max(1, Math.ceil(withMessages.length / 10));
  const concentration = {
    members: withMessages.length,
    top1: withMessages.length ? withMessages[0] / messagesTotal : 0,
    topTenth: messagesTotal ? sum(withMessages.slice(0, topTenth)) / messagesTotal : 0,
    topTenthCount: topTenth,
  };

  // How the server grows: the members at the end of each day (counted back from the members now), and how long the ones who left had stayed.
  let memberLine = null;
  if (Number.isFinite(memberTotal)) {
    let running = memberTotal;
    memberLine = Array(current.length);
    for (let i = current.length - 1; i >= 0; i -= 1) {
      memberLine[i] = Math.max(0, running);
      running -= now_.series.net[i];
    }
  }
  const lifespan = Array(LIFESPAN_BUCKETS).fill(0);
  for (const row of only(lifespanRows, inCurrent)) {
    const bucket = Math.max(0, Math.min(LIFESPAN_BUCKETS - 1, num(row.bucket)));
    lifespan[bucket] += num(row.members);
  }
  const lifespanTotal = sum(lifespan);

  return {
    days,
    current: now_,
    previous: before,
    change,
    heatmap,
    peak: best,
    byHour,
    byWeekday,
    dayparts,
    topChannels: { messages: ranked(channels, 'messages', 10), voice: ranked(channels, 'voiceSeconds', 10) },
    topMembers: { messages: ranked(members, 'messages', 10), voice: ranked(members, 'voiceSeconds', 10), concentration },
    growth: { memberLine, lifespan, lifespanTotal, earlyLeaveShare: lifespanTotal ? (lifespan[0] + lifespan[1]) / lifespanTotal : null, stayedShare: lifespanTotal ? (lifespan[3] + lifespan[4]) / lifespanTotal : null },
    content: {
      links: now_.totals.links, attachments: now_.totals.attachments, replies: now_.totals.replies, mentions: now_.totals.mentions,
      per100: (key) => (now_.totals.messages ? Math.round((now_.totals[key] / now_.totals.messages) * 1000) / 10 : 0),
    },
  };
}

/** The text channels (ids) that had no message in the period, from the channels the server has and the rows of the counters. */
function quietChannels(textChannelIds, channelRows, days, now = new Date()) {
  const { current } = windows(days, now);
  const inPeriod = new Set(current);
  const active = new Set(channelRows.filter((row) => inPeriod.has(dayKey(row.day)) && num(row.messages) > 0).map((row) => row.channel_id));
  return textChannelIds.filter((id) => !active.has(id));
}

/** The longest run of active days that ends today (or yesterday: the day is not over). */
function currentStreak(activeDays, today = botDay()) {
  const set = new Set(activeDays);
  const yesterday = botDay(new Date(new Date(`${today}T12:00:00-05:00`).getTime() - DAY_MS));
  let cursor = set.has(today) ? today : set.has(yesterday) ? yesterday : null;
  let streak = 0;
  while (cursor && set.has(cursor)) {
    streak += 1;
    cursor = botDay(new Date(new Date(`${cursor}T12:00:00-05:00`).getTime() - DAY_MS));
  }
  return streak;
}

/**
 * What one member did in the period, set against the period before and against the others of the server. `userRows` are the counters per day of
 * this member (both periods) and `memberTotals` the totals of every member in the period (user_id, messages, voice_seconds), for their place. A server
 * that keeps nothing per member has no rows, and the answer says so (`counted: false`).
 */
function buildMemberStats({ userId, days = 30, now = new Date(), userRows = [], memberTotals = [] }) {
  const { current, previous } = windows(days, now);
  const inCurrent = new Set(current);
  const inPrevious = new Set(previous);
  const mine = { current: userRows.filter((row) => inCurrent.has(dayKey(row.day))), previous: userRows.filter((row) => inPrevious.has(dayKey(row.day))) };
  const perUser = new Map(memberTotals.map((row) => [row.user_id, { messages: num(row.messages), voiceSeconds: num(row.voice_seconds) }]));
  const totals = (rows) => ({ messages: sum(rows.map((row) => num(row.messages))), voiceSeconds: sum(rows.map((row) => num(row.voice_seconds))) });
  const now_ = totals(mine.current);
  const before = totals(mine.previous);
  const activeDays = [...new Set(mine.current.filter((row) => num(row.messages) > 0 || num(row.voice_seconds) > 0).map((row) => dayKey(row.day)))];
  const rankIn = (key, mineValue) => {
    if (mineValue <= 0) return null;
    const values = [...perUser.values()].map((entry) => entry[key]).filter((value) => value > 0);
    // The member is counted among the others even when the totals were read a moment before their last message.
    return { rank: values.filter((value) => value > mineValue).length + 1, of: Math.max(values.length, 1) };
  };
  const everyone = { messages: sum([...perUser.values()].map((entry) => entry.messages)), voiceSeconds: sum([...perUser.values()].map((entry) => entry.voiceSeconds)) };
  const daily = current.map((day) => sum(mine.current.filter((row) => dayKey(row.day) === day).map((row) => num(row.messages))));
  let bestDay = null;
  daily.forEach((value, i) => { if (value > 0 && (!bestDay || value > bestDay.value)) bestDay = { day: current[i], value }; });
  return {
    userId, days,
    counted: perUser.size > 0,
    totals: now_,
    previous: before,
    change: { messages: percentChange(now_.messages, before.messages), voiceSeconds: percentChange(now_.voiceSeconds, before.voiceSeconds) },
    activeDays: activeDays.length,
    activeShare: current.length ? activeDays.length / current.length : 0,
    streak: currentStreak(activeDays, current[current.length - 1]),
    perActiveDay: activeDays.length ? now_.messages / activeDays.length : 0,
    rank: { messages: rankIn('messages', now_.messages), voice: rankIn('voiceSeconds', now_.voiceSeconds) },
    share: { messages: everyone.messages ? Math.min(1, now_.messages / everyone.messages) : 0, voice: everyone.voiceSeconds ? Math.min(1, now_.voiceSeconds / everyone.voiceSeconds) : 0 },
    daily, dayLabels: current, bestDay,
  };
}

module.exports = { percentChange, windows, buildStatsV2, buildMemberStats, quietChannels, currentStreak, weekdayOf, LIFESPAN_BUCKETS };
