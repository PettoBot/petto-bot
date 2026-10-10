// Turns the activity counters of the last days into what `/summary` shows: a number per day for every metric, the totals,
// the active members, the most active hour (GMT-5) and the top channels and members. No database here, so it can be tested.
const METRICS = ['overview', 'messages', 'voice', 'joins', 'leaves', 'invites', 'sanctions'];

// The kinds of sanction counted together, and the ones that undo another (counted apart).
const GROUPS = {
  bans: ['ban', 'hardban', 'tempban', 'softban'],
  mutes: ['mute', 'tempmute'],
  warns: ['warn'],
  kicks: ['kick'],
  jails: ['jail'],
};
const UNDONE = ['unban', 'unmute', 'unjail'];
const SOURCES = ['moderator', 'automod', 'honeypot', 'escalation', 'expiry', 'antinuke'];

const { botDay } = require('./botTime');
const dayKey = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const num = (value) => Number(value ?? 0) || 0;

/** The last `days` days of Colombia (GMT-5), the oldest first, as `YYYY-MM-DD`. */
function daysList(days, now = new Date()) {
  const list = [];
  for (let back = days - 1; back >= 0; back -= 1) list.push(botDay(new Date(now.getTime() - back * 86_400_000)));
  return list;
}

function top(map, key, limit) {
  return [...map.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b[key] - a[key] || b.messages - a.messages).filter((row) => row[key] > 0).slice(0, limit);
}

function peak(values) {
  let best = -1;
  values.forEach((value, hour) => { if (value > 0 && (best === -1 || value > values[best])) best = hour; });
  return best === -1 ? null : { hour: best, value: values[best] };
}

function buildSummary({ days = 7, channelRows = [], hourlyRows = [], flowRows = [], memberRows = [], caseRows = [], botId = null, now = new Date() }) {
  const list = daysList(days, now);
  const index = new Map(list.map((day, i) => [day, i]));
  const series = () => list.map(() => 0);
  const daily = { messages: series(), reactions: series(), voice: series(), joins: series(), leaves: series(), invited: series() };

  const channels = new Map();
  for (const row of channelRows) {
    const i = index.get(dayKey(row.day));
    if (i === undefined) continue;
    daily.messages[i] += num(row.messages);
    daily.reactions[i] += num(row.reactions);
    daily.voice[i] += num(row.voice_seconds);
    const current = channels.get(row.channel_id) ?? { messages: 0, voiceSeconds: 0 };
    current.messages += num(row.messages);
    current.voiceSeconds += num(row.voice_seconds);
    channels.set(row.channel_id, current);
  }

  for (const row of flowRows) {
    const i = index.get(dayKey(row.day));
    if (i === undefined) continue;
    daily.joins[i] += num(row.joins);
    daily.leaves[i] += num(row.leaves);
    daily.invited[i] += num(row.invited);
  }

  const hours = { messages: Array(24).fill(0), voice: Array(24).fill(0) };
  for (const row of hourlyRows) {
    if (!index.has(dayKey(row.day))) continue;
    const hour = Math.max(0, Math.min(23, num(row.hour)));
    hours.messages[hour] += num(row.messages);
    hours.voice[hour] += num(row.voice_seconds);
  }

  const members = new Map();
  for (const row of memberRows) {
    if (!index.has(dayKey(row.day))) continue;
    const current = members.get(row.user_id) ?? { messages: 0, voiceSeconds: 0 };
    current.messages += num(row.messages);
    current.voiceSeconds += num(row.voice_seconds);
    members.set(row.user_id, current);
  }

  // Sanctions: the cases of the period by day, kind, who applied them and who got them.
  const sanctionDaily = list.map(() => 0);
  const byGroup = { bans: 0, mutes: 0, warns: 0, kicks: 0, jails: 0, undone: 0 };
  const bySource = Object.fromEntries(SOURCES.map((source) => [source, 0]));
  const moderators = new Map();
  const sanctioned = new Map();
  for (const row of caseRows) {
    const i = index.get(botDay(row.created_at));
    if (i === undefined) continue;
    if (UNDONE.includes(row.type)) { byGroup.undone += 1; continue; }
    const group = Object.keys(GROUPS).find((key) => GROUPS[key].includes(row.type));
    if (!group) continue;
    byGroup[group] += 1;
    sanctionDaily[i] += 1;
    // A case made by the bot itself with no source (an older one, or a jail from escalation) is automatic too.
    const source = row.source && row.source !== 'moderator' ? row.source : (botId && row.moderator_id === botId ? 'automod' : 'moderator');
    bySource[source in bySource ? source : 'moderator'] += 1;
    if (source === 'moderator') moderators.set(row.moderator_id, (moderators.get(row.moderator_id) ?? 0) + 1);
    sanctioned.set(row.user_id, (sanctioned.get(row.user_id) ?? 0) + 1);
  }
  const ranked = (map) => [...map.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  const sanctionTotal = sanctionDaily.reduce((a, b) => a + b, 0);

  const sum = (values) => values.reduce((a, b) => a + b, 0);
  const weekdays = { messages: Array(7).fill(0), voice: Array(7).fill(0), joins: Array(7).fill(0), leaves: Array(7).fill(0), invited: Array(7).fill(0) };
  list.forEach((day, i) => {
    const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
    for (const key of Object.keys(weekdays)) weekdays[key][weekday] += daily[key === 'voice' ? 'voice' : key][i];
  });

  return {
    days: list,
    daily,
    hours,
    weekdays,
    totals: {
      messages: sum(daily.messages), reactions: sum(daily.reactions), voiceSeconds: sum(daily.voice),
      joins: sum(daily.joins), leaves: sum(daily.leaves), invited: sum(daily.invited), activeMembers: members.size,
      activeChannels: [...channels.values()].filter((c) => c.messages || c.voiceSeconds).length,
    },
    sanctions: { total: sanctionTotal, daily: sanctionDaily, byGroup, bySource, automatic: sanctionTotal - bySource.moderator, topModerators: ranked(moderators), topUsers: ranked(sanctioned) },
    peakHour: { messages: peak(hours.messages), voice: peak(hours.voice) },
    topChannels: { messages: top(channels, 'messages', 5), voice: top(channels, 'voiceSeconds', 5) },
    topMembers: { messages: top(members, 'messages', 5), voice: top(members, 'voiceSeconds', 5) },
  };
}

function bestDay(summary, key) {
  const values = summary.daily[key];
  let best = -1;
  values.forEach((value, i) => { if (value > 0 && (best === -1 || value > values[best])) best = i; });
  return best === -1 ? null : { day: summary.days[best], value: values[best] };
}

const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00`;

module.exports = { METRICS, GROUPS, SOURCES, buildSummary, bestDay, hourLabel, daysList };
