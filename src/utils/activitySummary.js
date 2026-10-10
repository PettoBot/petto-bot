// Turns the activity counters of the last days into what `/summary` shows: a number per day for every metric, the totals,
// the active members, the most active hour (UTC) and the top channels and members. No database here, so it can be tested.
const METRICS = ['overview', 'messages', 'voice', 'joins', 'leaves', 'invites'];

const dayKey = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const num = (value) => Number(value ?? 0) || 0;

function daysList(days, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const list = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - back);
    list.push(day.toISOString().slice(0, 10));
  }
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

function buildSummary({ days = 7, channelRows = [], hourlyRows = [], flowRows = [], memberRows = [], now = new Date() }) {
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

module.exports = { METRICS, buildSummary, bestDay, hourLabel, daysList };
