// The text under the picture of `/summary`. Pure, so it can be checked without Discord. The picture already has the numbers,
// so this is only a few friendly lines with Petto's emojis: the busiest hour and day, and who stood out.
const { bestDay, hourLabel } = require('./activitySummary');
const { EMOJI } = require('./emojis');

const n = (value) => Number(value).toLocaleString('en-US');
const dayText = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hours = (seconds) => { const m = Math.floor(seconds / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

const MAX_LINES = 4;
const ICON = { time: EMOJI.FIELD_CALENDAR, good: EMOJI.APPROVE, star: EMOJI.STAR, note: EMOJI.FIELD_NOTES, alert: EMOJI.ALERT, hammer: EMOJI.HAMMER };

const names = (entries, limit = 3) => entries.slice(0, limit).join('  ·  ');
const growthLine = (totals) => {
  const growth = totals.joins - totals.leaves;
  if (!totals.joins && !totals.leaves) return null;
  if (growth > 0) return `${ICON.good} The server grew by **${n(growth)}** member${growth === 1 ? '' : 's'}`;
  if (growth < 0) return `${ICON.alert} **${n(-growth)}** more member${growth === -1 ? '' : 's'} left than joined`;
  return `${ICON.note} The same number of members joined and left`;
};

function busiest(summary, key, noun, peak, label) {
  const best = key === 'sanctions' ? bestSanctionDay(summary) : bestDay(summary, key);
  const parts = [];
  if (peak) parts.push(`**${hourLabel(peak.hour)}** GMT-5${label ? ` (${label(peak.value)})` : ''}`);
  if (best) parts.push(`best day **${dayText(best.day)}** (${n(best.value)} ${noun})`);
  return parts.length ? `${ICON.time} Busiest hour  ${parts.join('  ·  ')}` : null;
}

function bestSanctionDay(summary) {
  const values = summary.sanctions.daily;
  let best = -1;
  values.forEach((value, i) => { if (value > 0 && (best === -1 || value > values[best])) best = i; });
  return best === -1 ? null : { day: summary.days[best], value: values[best] };
}

/** The lines under the picture, at most four. */
function describeSummary(metric, summary, days, inviters = []) {
  const { totals } = summary;
  const channels = (rows, value) => rows.map((r) => `<#${r.id}> ${value(r)}`);
  const members = (rows, value) => rows.map((r) => `<@${r.id}> ${value(r)}`);
  const out = [];

  if (metric === 'voice') {
    out.push(`${ICON.star} **${hours(totals.voiceSeconds)}** chatting in voice, about ${hours(totals.voiceSeconds / days)} a day`);
    out.push(busiest(summary, 'voice', 'in voice', summary.peakHour.voice, (v) => hours(v)));
    if (summary.topChannels.voice.length) out.push(`${ICON.note} Favorite rooms  ${names(channels(summary.topChannels.voice, (r) => hours(r.voiceSeconds)), 2)}`);
    if (summary.topMembers.voice.length) out.push(`${ICON.star} Voice stars  ${names(members(summary.topMembers.voice, (r) => hours(r.voiceSeconds)))}`);
  } else if (metric === 'sanctions') {
    const s = summary.sanctions;
    if (!s.total) return [`${ICON.good} A calm period: no sanctions`];
    const label = { moderator: 'moderators', automod: 'automod', honeypot: 'honeypot', escalation: 'escalation', expiry: 'expiry', antinuke: 'anti-nuke' };
    const sources = Object.entries(s.bySource).filter(([, count]) => count > 0).map(([key, count]) => `${label[key] ?? key} ${n(count)}`);
    out.push(`${ICON.hammer} Applied by  ${names(sources, 4)}`);
    out.push(busiest(summary, 'sanctions', 'sanctions', null, null));
    if (s.topModerators.length) out.push(`${ICON.star} Busiest moderators  ${names(s.topModerators.map((r) => `<@${r.id}> ${n(r.count)}`), 2)}`);
    if (s.topUsers.length) out.push(`${ICON.alert} Most sanctioned  ${names(s.topUsers.map((r) => `<@${r.id}> ${n(r.count)}`), 2)}`);
  } else if (['joins', 'leaves', 'invites'].includes(metric)) {
    if (!totals.joins && !totals.leaves) return [`${ICON.note} Joins and leaves are counted from the moment this was added`];
    out.push(growthLine(totals));
    if (totals.joins) out.push(`${ICON.star} **${Math.round((totals.invited / totals.joins) * 100)}%** of the joins came through an invite`);
    out.push(busiest(summary, metric === 'invites' ? 'invited' : metric, metric === 'leaves' ? 'left' : 'joined', null, null));
    if (metric === 'invites' && inviters.length) out.push(`${ICON.star} Top inviters  ${names(inviters.map((r) => `<@${r.inviter_id}> ${n(r.net)}`))}`);
  } else {
    out.push(busiest(summary, 'messages', 'messages', summary.peakHour.messages, (v) => `${n(v)} messages`));
    if (summary.topChannels.messages.length) out.push(`${ICON.note} Favorite channels  ${names(channels(summary.topChannels.messages, (r) => n(r.messages)), 2)}`);
    if (summary.topMembers.messages.length) out.push(`${ICON.star} Chattiest  ${names(members(summary.topMembers.messages, (r) => n(r.messages)))}`);
    if (metric === 'overview') out.push(growthLine(totals));
  }
  return out.filter(Boolean).slice(0, MAX_LINES);
}

module.exports = { describeSummary };
