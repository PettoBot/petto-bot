const { TYPE_EMOJI } = require('./emojis');

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** One-line summary of a case, for list views like /infrs. */
function formatCaseLine(row) {
  const emoji = TYPE_EMOJI[row.type] ?? '';
  const ts = Math.floor(new Date(row.created_at).getTime() / 1000);
  const activeTag = row.active === false ? ' *(inactive)*' : '';
  return `${emoji} \`#${row.case_number}\` **${row.type}** · <@${row.user_id}> · <t:${ts}:R>${activeTag}\n> ${row.reason || 'No reason provided.'}`;
}

/** Full detail block for a single case, for /linfr, /searchinf, and pre-delete/modify confirmations. */
function formatCaseDetail(row) {
  const emoji = TYPE_EMOJI[row.type] ?? '';
  const ts = Math.floor(new Date(row.created_at).getTime() / 1000);
  const lines = [
    `### ${emoji} Case #${row.case_number} · ${capitalize(row.type)}`.trim(),
    `**User:** <@${row.user_id}> (\`${row.user_id}\`)`,
    `**Moderator:** <@${row.moderator_id}> (\`${row.moderator_id}\`)`,
    `**When:** <t:${ts}:F> (<t:${ts}:R>)`,
  ];

  if (row.expires_at) {
    const expTs = Math.floor(new Date(row.expires_at).getTime() / 1000);
    lines.push(`**Expires:** <t:${expTs}:F> (<t:${expTs}:R>)`);
  }

  lines.push(`**Active:** ${row.active ? 'Yes' : 'No'}`);
  lines.push(`**Reason:** ${row.reason || 'No reason provided.'}`);
  return lines.join('\n');
}

module.exports = { formatCaseLine, formatCaseDetail };
