const { EMOJI } = require('./emojis');
const { t, tn, currentLanguage } = require('../i18n');
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

/**
 * Builds the DM sent to a sanctioned user, shared by every sanction command
 * (ban/kick/mute/warn/tempban/tempmute) so they all read the same way:
 *
 *   <emoji>  You have been banned from **Guild Name** for 7 days | Reason: `spamming`
 *
 *   -# Sent from 'Petto' (`123456789012345678`) with 214 members
 *
 * It is written in `lang`, the language of the server (the caller finds it).
 */
function buildSanctionDM({ type, guild, client, reason, duration, appealUrl = null, appealNote = null, lang = currentLanguage() }) {
  // The server's own line about appeals replaces Petto's sentence; the link is in it (or after it).
  const appealLine = appealUrl ? (appealNoteText(appealNote, appealUrl, guild.name) ?? t(lang, 'moderation.dm.appeal', { url: appealUrl })) : null;
  const emoji = EMOJI.HAMMER;
  const action = t(lang, `moderation.dm.${DM_TYPES.has(type) ? type : 'unknown'}${duration ? 'Timed' : ''}`, { server: guild.name, duration });
  const reasonPart = reason ? t(lang, 'moderation.dm.reason', { reason: displayReason(reason, lang) }) : '';

  return [
    `${emoji}  ${action}${reasonPart}`,
    ...(appealLine ? ['', appealLine] : []),
    '',
    tn(lang, 'moderation.dm.footer', guild.memberCount, { bot: client.user.username, id: guild.id, count: guild.memberCount }),
  ].join('\n');
}

module.exports = { buildSanctionDM, appealNoteText };
