// The text under the picture of `/summary`. Pure, so it can be checked without Discord.
const { bestDay, hourLabel } = require('./activitySummary');
const { EMOJI } = require('./emojis');

const n = (value) => Number(value).toLocaleString('en-US');
const dayText = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hours = (seconds) => { const m = Math.floor(seconds / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

const row = (icon, label, value) => `${icon} **${label}** ${value}`;
const dot = EMOJI.FIELD_DOT;
const clock = EMOJI.FIELD_CALENDAR;
const peakLine = (peak, label) => (peak ? row(clock, 'Most active hour', `${hourLabel(peak.hour)}–${hourLabel((peak.hour + 1) % 24)} GMT-5 · ${label(peak.value)}`) : null);

function bestSanctionDay(summary) {
  const values = summary.sanctions.daily;
  let best = -1;
  values.forEach((value, i) => { if (value > 0 && (best === -1 || value > values[best])) best = i; });
  return best === -1 ? null : { day: summary.days[best], value: values[best] };
}

/**
 * What goes under the picture. The picture already has the numbers, so this is only what it cannot show: the busiest hour and
 * day, and the top lists, each on one line with at most three names.
 */
function describeSummary(metric, summary, days, inviters) {
  const { totals } = summary;
  const top = (icon, title, entries) => (entries.length ? row(icon, title, entries.slice(0, 3).join('  ·  ')) : null);
  const channels = (rows, value) => rows.map((r) => `<#${r.id}> ${value(r)}`);
  const members = (rows, value) => rows.map((r) => `<@${r.id}> ${value(r)}`);
  const bestOf = (key, noun) => { const best = key === 'sanctions' ? bestSanctionDay(summary) : bestDay(summary, key); return best ? row(clock, 'Best day', `${dayText(best.day)} · ${n(best.value)} ${noun}`) : null; };
  const growth = totals.joins - totals.leaves;
  const growthText = `${growth >= 0 ? '+' : ''}${n(growth)} members`;
  const out = [];

  if (metric === 'voice') {
    out.push(row(dot, 'Voice time', `${hours(totals.voiceSeconds)} · ${hours(totals.voiceSeconds / days)} a day`));
    out.push(peakLine(summary.peakHour.voice, (v) => hours(v)));
    out.push(top(EMOJI.FIELD_NOTES, 'Top channels', channels(summary.topChannels.voice, (r) => hours(r.voiceSeconds))));
    out.push(top(EMOJI.FIELD_NOTES, 'Top members', members(summary.topMembers.voice, (r) => hours(r.voiceSeconds))));
  } else if (metric === 'sanctions') {
    const s = summary.sanctions;
    const label = { moderator: 'moderators', automod: 'automod', honeypot: 'honeypot', escalation: 'escalation', expiry: 'expiry', antinuke: 'anti-nuke' };
    const sources = Object.entries(s.bySource).filter(([, count]) => count > 0).map(([key, count]) => `${label[key] ?? key} ${n(count)}`);
    if (sources.length) out.push(row(dot, 'Applied by', sources.join('  ·  ')));
    if (s.byGroup.undone) out.push(row(dot, 'Undone', n(s.byGroup.undone)));
    out.push(bestOf('sanctions', 'sanctions'));
    out.push(top(EMOJI.FIELD_NOTES, 'Moderators', s.topModerators.map((r) => `<@${r.id}> ${n(r.count)}`)));
    out.push(top(EMOJI.FIELD_NOTES, 'Most sanctioned', s.topUsers.map((r) => `<@${r.id}> ${n(r.count)}`)));
    if (!s.total) out.push('-# No sanctions in this period.');
  } else if (['joins', 'leaves', 'invites'].includes(metric)) {
    out.push(row(dot, 'Growth', `${growthText} (${n(totals.joins)} joined, ${n(totals.leaves)} left)`));
    if (totals.joins) out.push(row(dot, 'Through invites', `${n(totals.invited)} (${Math.round((totals.invited / totals.joins) * 100)}% of the joins)`));
    out.push(bestOf(metric === 'invites' ? 'invited' : metric, metric === 'leaves' ? 'left' : 'joined'));
    if (metric === 'invites') out.push(top(EMOJI.FIELD_NOTES, 'Top inviters', inviters.map((r) => `<@${r.inviter_id}> ${n(r.net)}`)));
    if (!totals.joins && !totals.leaves) out.push('-# Joins and leaves are counted from the moment this was added.');
  } else {
    if (metric === 'overview') out.push(row(dot, 'Growth', `${growthText} (${n(totals.joins)} joined, ${n(totals.leaves)} left)`));
    else out.push(row(dot, 'Per day', `${n(Math.round(totals.messages / days))} messages · ${n(totals.activeMembers)} active members`));
    out.push(peakLine(summary.peakHour.messages, (v) => `${n(v)} messages`));
    out.push(bestOf('messages', 'messages'));
    out.push(top(EMOJI.FIELD_NOTES, 'Top channels', channels(summary.topChannels.messages, (r) => n(r.messages))));
    out.push(top(EMOJI.FIELD_NOTES, 'Top members', members(summary.topMembers.messages, (r) => n(r.messages))));
    if (metric === 'overview' && summary.sanctions.total) out.push(row(dot, 'Sanctions', `${n(summary.sanctions.total)} · ${n(summary.sanctions.automatic)} automatic`));
    if (metric === 'overview') out.push(top(EMOJI.FIELD_NOTES, 'Top inviters', inviters.map((r) => `<@${r.inviter_id}> ${n(r.net)}`)));
  }
  return out.filter(Boolean);
}

module.exports = { describeSummary };
