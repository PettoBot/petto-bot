const { EMOJI } = require('./emojis');
const { t, currentLanguage } = require('../i18n');
const { displayReason } = require('./caseFormat');

// The sanctions that have their own sentence in the DM; any other type uses `moderation.dm.unknown`.
const DM_TYPES = new Set(['ban', 'hardban', 'tempban', 'softban', 'unban', 'kick', 'mute', 'tempmute', 'unmute', 'warn', 'jail', 'unjail']);

/** The server's own line about appeals in the sanction DM, with `{link}` and `{server}` filled; the link goes at the end when the line has no `{link}`. */
function appealNoteText(note, url, serverName = '') {
  const text = String(note ?? '').replace(/\u0000/g, '').trim().slice(0, 300);
  if (!text || !url) return null;
  const filled = text.replace(/\{server\}/g, serverName);
  return filled.includes('{link}') ? filled.replace(/\{link\}/g, url) : `${filled} ${url}`;
}

// The sanctions that have no end unless a duration is given: the DM says "Permanent" for them (the others, a warn or a kick, have no duration to say).
const OPEN_ENDED = new Set(['ban', 'hardban', 'mute', 'jail']);

/**
 * Builds the DM sent to a sanctioned user, shared by every sanction command (ban/kick/mute/warn/tempban/tempmute) so they all read the same way:
 *
 *   <emoji>  You have been banned from **Guild Name** for 7 days
 *   **Reason:** spamming
 *   **Duration:** Permanent        (only for a sanction that has no end; a timed one says its time in the first line)
 *   -# Case #12                    (when the case is known)
 *
 * The line that says where it comes from ("From Guild Name") and the three buttons are added when it is sent (utils/dmOrigin.js), so the text does not repeat the
 * server or who sent it. It is written in `lang`, the language of the server (the caller finds it), not the one of the person.
 */
function buildSanctionDM({ type, guild, reason, duration, caseNumber = null, appealUrl = null, appealNote = null, lang = currentLanguage() }) {
  // The server's own line about appeals replaces Petto's sentence; the link is in it (or after it).
  const appealLine = appealUrl ? (appealNoteText(appealNote, appealUrl, guild.name) ?? t(lang, 'moderation.dm.appeal', { url: appealUrl })) : null;
  const emoji = EMOJI.HAMMER;
  const action = t(lang, `moderation.dm.${DM_TYPES.has(type) ? type : 'unknown'}${duration ? 'Timed' : ''}`, { server: guild.name, duration });
  const lines = [`${emoji}  ${action}`];
  if (reason) lines.push(t(lang, 'moderation.dm.reasonLine', { reason: displayReason(reason, lang) }));
  if (!duration && OPEN_ENDED.has(type)) lines.push(t(lang, 'moderation.dm.durationLine', { duration: t(lang, 'moderation.dm.permanent') }));
  if (caseNumber != null) lines.push(t(lang, 'moderation.dm.caseLine', { number: caseNumber }));
  if (appealLine) lines.push('', appealLine);
  return lines.join('\n');
}

module.exports = { buildSanctionDM, appealNoteText };
