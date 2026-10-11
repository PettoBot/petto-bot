// What to answer when a command that sets a saved embed is used without the name of one: instead of an error about a missing argument,
// it says which one is in use now and which ones exist, so the next try can be right.
const { listTemplates } = require('../db/embedTemplates');

/**
 * `current` is the saved embed in use (or empty), `usage` the way to set one (for example `!bumpreminder template reminder <name>`).
 * Returns the text of the answer.
 */
async function templateHint(guildId, { current, usage, what = 'message' } = {}) {
  const rows = await listTemplates(guildId).catch(() => []);
  const names = rows.map((row) => row.name);
  // `current` left out means it is not known here, so nothing is said about it.
  const lines = current === undefined ? [] : [`**${what}:** ${current ? `uses the saved embed \`${current}\`` : 'uses its usual text, no saved embed'}`];
  if (names.length) {
    const shown = names.slice(0, 15).map((name) => `\`${name}\``).join(', ');
    lines.push(`**Saved embeds:** ${shown}${names.length > 15 ? ` and ${names.length - 15} more` : ''}`);
  } else {
    lines.push('You have no saved embeds yet. Make one in the dashboard, under Embeds.');
  }
  if (usage) lines.push(`To choose one: \`${usage}\`. Use \`none\` to go back to the usual text.`);
  return lines.join('\n');
}

module.exports = { templateHint };
