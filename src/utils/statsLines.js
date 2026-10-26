// The friendly lines under the pictures of `!stats`. Pure, so they can be checked without Discord. The picture has the numbers; these say
// the one thing worth reading: the busiest time, the best day, who writes most, how many channels were quiet, how long the ones who left had stayed.
const { hourLabel } = require('./activitySummary');
const { EMOJI } = require('./emojis');
const { t, tn, formatNumber, currentLanguage } = require('../i18n');

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DATE_LOCALES = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };
const dayText = (day, lang) => new Date(`${day}T00:00:00Z`).toLocaleDateString(DATE_LOCALES[lang] ?? 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const percent = (share) => Math.round(share * 100);

function peakLine(stats, lang) {
  if (!stats.peak) return null;
  return t(lang, 'info.stats.line.peak', { emoji: EMOJI.FIELD_CALENDAR, day: t(lang, `info.summaryCard.day.${WEEKDAYS[stats.peak.weekday]}`), hour: hourLabel(stats.peak.hour), count: formatNumber(lang, stats.peak.value) });
}

function bestDayLine(stats, lang) {
  const values = stats.current.series.messages;
  let best = -1;
  values.forEach((value, i) => { if (value > 0 && (best === -1 || value > values[best])) best = i; });
  return best === -1 ? null : t(lang, 'info.stats.line.bestDay', { emoji: EMOJI.STAR, day: dayText(stats.current.days[best], lang), count: formatNumber(lang, values[best]) });
}

function concentrationLine(stats, lang) {
  const c = stats.topMembers.concentration;
  if (!c.members) return null;
  return t(lang, 'info.stats.line.concentration', { emoji: EMOJI.MEMBERS, count: c.topTenthCount, total: formatNumber(lang, c.members), percent: percent(c.topTenth) });
}

/** The channels with no messages: a few of them named, and how many more. `mention(id)` writes a channel. */
function quietLine(quiet, lang, mention = (id) => `<#${id}>`, shown = 8) {
  if (!quiet.length) return t(lang, 'info.stats.line.quietNone', { emoji: EMOJI.APPROVE });
  const list = quiet.slice(0, shown).map(mention).join(' ') + (quiet.length > shown ? tn(lang, 'info.stats.line.quietMore', quiet.length - shown, { count: quiet.length - shown }) : '');
  return t(lang, 'info.stats.line.quiet', { emoji: EMOJI.FIELD_NOTES, count: formatNumber(lang, quiet.length), list });
}

function stayLine(stats, lang) {
  if (stats.growth.earlyLeaveShare === null) return null;
  return t(lang, 'info.stats.line.stay', { emoji: EMOJI.MEMBERS, percent: percent(stats.growth.earlyLeaveShare) });
}

function netLine(stats, lang) {
  const { joins, leaves, net } = stats.current.totals;
  if (!joins && !leaves) return null;
  return t(lang, 'info.stats.line.net', { emoji: EMOJI.MEMBERS, joined: formatNumber(lang, joins), left: formatNumber(lang, leaves), net: `${net > 0 ? '+' : ''}${formatNumber(lang, net)}` });
}

/** The lines of a subcommand (`overview`, `heatmap`, `members`, `growth`, `compare`; `channels` takes its own with the quiet channels). */
function describeStats(kind, stats, lang = currentLanguage()) {
  const lines = [];
  if (kind === 'overview') lines.push(peakLine(stats, lang), bestDayLine(stats, lang), concentrationLine(stats, lang));
  else if (kind === 'heatmap') lines.push(peakLine(stats, lang));
  else if (kind === 'members') lines.push(concentrationLine(stats, lang));
  else if (kind === 'growth') lines.push(netLine(stats, lang), stayLine(stats, lang));
  else if (kind === 'compare') lines.push(bestDayLine(stats, lang));
  return lines.filter(Boolean);
}

module.exports = { describeStats, quietLine, peakLine, bestDayLine, concentrationLine, stayLine, netLine };
