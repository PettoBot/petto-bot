const { TYPE_EMOJI } = require('./emojis');
const { t, tn, currentLanguage } = require('../i18n');

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** The name of a case type (`ban`, `tempmute`…) in `lang`; English shows the type itself. */
function typeName(type, lang = currentLanguage()) {
  const key = `moderation.type.${type}`;
  const text = t(lang, key);
  return text === key ? String(type) : text;
}

// The reasons Petto writes by itself are saved in English (the database keeps what it always kept) and translated when shown.
const AUTOMATIC_REASONS = [
  [/^Automatic expiry$/, (lang) => t(lang, 'moderation.reason.expiry')],
  [/^Automatic escalation: reached (\d+) warning\(s\)\.$/, (lang, match) => tn(lang, 'moderation.reason.escalation', Number(match[1]), { count: match[1] })],
  [/^Lifted from the dashboard by (.+)$/s, (lang, match) => t(lang, 'moderation.reason.liftedDashboard', { name: match[1] })],
  [/^Appeal accepted$/, (lang) => t(lang, 'moderation.reason.appealAccepted')],
];

/** A saved reason as it is shown in `lang`: the automatic ones are translated, the ones people wrote stay as they are. */
function displayReason(reason, lang = currentLanguage()) {
  if (!reason || lang === 'en') return reason;
  for (const [pattern, translate] of AUTOMATIC_REASONS) {
    const match = pattern.exec(reason);
    if (match) return translate(lang, match);
  }
  return reason;
}

/** The reason of a case for a card or a log, or "No reason provided." when there is none. */
function reasonText(reason, lang = currentLanguage()) {
  return displayReason(reason, lang) || t(lang, 'moderation.reason.none');
}

/** One-line summary of a case, for list views like /infrs. */
function formatCaseLine(row, lang = currentLanguage()) {
  const emoji = TYPE_EMOJI[row.type] ?? '';
  const ts = Math.floor(new Date(row.created_at).getTime() / 1000);
  const activeTag = row.active === false ? t(lang, 'moderation.case.inactiveTag') : '';
  return `${emoji} \`#${row.case_number}\` **${typeName(row.type, lang)}** · <@${row.user_id}> · <t:${ts}:R>${activeTag}\n> ${reasonText(row.reason, lang)}`;
}

/** Full detail block for a single case, for /linfr, /searchinf, and pre-delete/modify confirmations. */
function formatCaseDetail(row, lang = currentLanguage()) {
  const emoji = TYPE_EMOJI[row.type] ?? '';
  const ts = Math.floor(new Date(row.created_at).getTime() / 1000);
  const lines = [
    `### ${emoji} ${t(lang, 'moderation.case.detail.title', { number: row.case_number, type: capitalize(typeName(row.type, lang)) })}`.trim(),
    t(lang, 'moderation.case.detail.user', { user: `<@${row.user_id}>`, id: row.user_id }),
    t(lang, 'moderation.case.detail.moderator', { moderator: `<@${row.moderator_id}>`, id: row.moderator_id }),
    t(lang, 'moderation.case.detail.when', { full: `<t:${ts}:F>`, relative: `<t:${ts}:R>` }),
  ];

  if (row.expires_at) {
    const expTs = Math.floor(new Date(row.expires_at).getTime() / 1000);
    lines.push(t(lang, 'moderation.case.detail.expires', { full: `<t:${expTs}:F>`, relative: `<t:${expTs}:R>` }));
  }

  lines.push(t(lang, row.active ? 'moderation.case.detail.activeYes' : 'moderation.case.detail.activeNo'));
  lines.push(t(lang, 'moderation.case.detail.reason', { reason: reasonText(row.reason, lang) }));
  if (row.evidence?.length) lines.push(t(lang, 'moderation.case.detail.evidence', { links: row.evidence.map((url, i) => `[${i + 1}](${url})`).join(' · ') }));
  return lines.join('\n');
}

module.exports = { formatCaseLine, formatCaseDetail, typeName, displayReason, reasonText, capitalize };
