// The text under the picture of `/summary`. Pure, so it can be checked without Discord. The picture already has the numbers,
// so this is only a few friendly lines with Petto's emojis: the busiest hour and day, and who stood out.
const { bestDay, hourLabel } = require('./activitySummary');
const { EMOJI } = require('./emojis');
const { t, tn, formatNumber, currentLanguage } = require('../i18n');

const DATE_LOCALES = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };
const dayText = (day, lang) => new Date(`${day}T00:00:00Z`).toLocaleDateString(DATE_LOCALES[lang] ?? 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hours = (seconds) => { const m = Math.floor(seconds / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

const MAX_LINES = 4;
const ICON = { time: EMOJI.FIELD_CALENDAR, good: EMOJI.APPROVE, star: EMOJI.STAR, note: EMOJI.FIELD_NOTES, alert: EMOJI.ALERT, hammer: EMOJI.HAMMER, members: EMOJI.MEMBERS };
// Who applied the sanctions: the catalog key of each source.
const SOURCE_KEYS = { moderator: 'moderators', automod: 'automod', honeypot: 'honeypot', escalation: 'escalation', expiry: 'expiry', antinuke: 'antinuke' };

const names = (entries, limit = 3) => entries.slice(0, limit).join('  ·  ');
const growthLine = (totals, lang) => {
  const growth = totals.joins - totals.leaves;
  if (!totals.joins && !totals.leaves) return null;
  if (growth > 0) return tn(lang, 'info.summary.text.grew', growth, { icon: ICON.members });
  if (growth < 0) return tn(lang, 'info.summary.text.shrank', -growth, { icon: ICON.members });
  return t(lang, 'info.summary.text.same', { icon: ICON.members });
};

/** `noun` is what the best day counted: `voice`, `sanctions`, `joined`, `left` or `messages`. */
function busiest(summary, key, noun, peak, label, lang) {
  const best = key === 'sanctions' ? bestSanctionDay(summary) : bestDay(summary, key);
  const parts = [];
  if (peak) parts.push(label ? t(lang, 'info.summary.text.peakWith', { hour: hourLabel(peak.hour), value: label(peak.value) }) : t(lang, 'info.summary.text.peak', { hour: hourLabel(peak.hour) }));
  if (best) parts.push(tn(lang, `info.summary.text.bestDay.${noun}`, best.value, { day: dayText(best.day, lang) }));
  return parts.length ? t(lang, 'info.summary.text.busiest', { icon: ICON.time, parts: parts.join('  ·  ') }) : null;
}

function bestSanctionDay(summary) {
  const values = summary.sanctions.daily;
  let best = -1;
  values.forEach((value, i) => { if (value > 0 && (best === -1 || value > values[best])) best = i; });
  return best === -1 ? null : { day: summary.days[best], value: values[best] };
}

/** The lines under the picture, at most four. `channelExists(id)` says whether a channel is still in the server. */
function describeSummary(metric, summary, days, inviters = [], { channelExists = () => true, lang = currentLanguage() } = {}) {
  const { totals } = summary;
  const n = (value) => formatNumber(lang, value);
  // A channel that is gone (deleted, or a temporary voice channel) would show as a bare number, so it is named for what it is.
  const channels = (rows, value) => rows.map((r) => `${channelExists(r.id) ? `<#${r.id}>` : t(lang, 'info.summary.text.goneChannel')} ${value(r)}`);
  const members = (rows, value) => rows.map((r) => `<@${r.id}> ${value(r)}`);
  const out = [];

  if (metric === 'voice') {
    out.push(t(lang, 'info.summary.text.voiceTotal', { icon: ICON.star, total: hours(totals.voiceSeconds), perDay: hours(totals.voiceSeconds / days) }));
    out.push(busiest(summary, 'voice', 'voice', summary.peakHour.voice, (v) => hours(v), lang));
    if (summary.topChannels.voice.length) out.push(t(lang, 'info.summary.text.favoriteRooms', { icon: ICON.note, list: names(channels(summary.topChannels.voice, (r) => hours(r.voiceSeconds)), 2) }));
    if (summary.topMembers.voice.length) out.push(t(lang, 'info.summary.text.voiceStars', { icon: ICON.star, list: names(members(summary.topMembers.voice, (r) => hours(r.voiceSeconds))) }));
  } else if (metric === 'sanctions') {
    const s = summary.sanctions;
    if (!s.total) return [t(lang, 'info.summary.text.calm', { icon: ICON.good })];
    const sources = Object.entries(s.bySource).filter(([, count]) => count > 0).map(([key, count]) => `${SOURCE_KEYS[key] ? t(lang, `info.summary.text.source.${SOURCE_KEYS[key]}`) : key} ${n(count)}`);
    out.push(t(lang, 'info.summary.text.appliedBy', { icon: ICON.hammer, list: names(sources, 4) }));
    out.push(busiest(summary, 'sanctions', 'sanctions', null, null, lang));
    if (s.topModerators.length) out.push(t(lang, 'info.summary.text.busiestModerators', { icon: ICON.star, list: names(s.topModerators.map((r) => `<@${r.id}> ${n(r.count)}`), 2) }));
    if (s.topUsers.length) out.push(t(lang, 'info.summary.text.mostSanctioned', { icon: ICON.alert, list: names(s.topUsers.map((r) => `<@${r.id}> ${n(r.count)}`), 2) }));
  } else if (['joins', 'leaves', 'invites'].includes(metric)) {
    if (!totals.joins && !totals.leaves) return [t(lang, 'info.summary.text.noFlowYet', { icon: ICON.members })];
    out.push(growthLine(totals, lang));
    if (totals.joins) out.push(t(lang, 'info.summary.text.viaInvites', { icon: ICON.members, percent: Math.round((totals.invited / totals.joins) * 100) }));
    out.push(busiest(summary, metric === 'invites' ? 'invited' : metric, metric === 'leaves' ? 'left' : 'joined', null, null, lang));
    if (metric === 'invites' && inviters.length) out.push(t(lang, 'info.summary.text.topInviters', { icon: ICON.members, list: names(inviters.map((r) => `<@${r.inviter_id}> ${n(r.net)}`)) }));
  } else {
    out.push(busiest(summary, 'messages', 'messages', summary.peakHour.messages, (v) => tn(lang, 'info.summary.text.messages', v), lang));
    if (summary.topChannels.messages.length) out.push(t(lang, 'info.summary.text.favoriteChannels', { icon: ICON.note, list: names(channels(summary.topChannels.messages, (r) => n(r.messages)), 2) }));
    if (summary.topMembers.messages.length) out.push(t(lang, 'info.summary.text.chattiest', { icon: ICON.star, list: names(members(summary.topMembers.messages, (r) => n(r.messages))) }));
    if (metric === 'overview') out.push(growthLine(totals, lang));
  }
  return out.filter(Boolean).slice(0, MAX_LINES);
}

module.exports = { describeSummary };
