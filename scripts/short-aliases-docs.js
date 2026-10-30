// The table of short aliases for the wiki, made from src/utils/short-aliases.json so the docs cannot drift from the bot:
//   node scripts/gen-short-aliases.js --wiki <path to petto-wiki-docs>
// The page (setup/short-aliases.mdx and its es and pt-br copies) keeps its own text; only what is between the two marks is written here.
const fs = require('node:fs');
const path = require('node:path');

const START = '{/* short-aliases:start (written by scripts/gen-short-aliases.js in petto-bot: do not edit by hand) */}';
const END = '{/* short-aliases:end */}';
const HEADERS = {
  '': ['Command', 'Short aliases'],
  es: ['Comando', 'Alias cortos'],
  'pt-br': ['Comando', 'Aliases curtos'],
};

/** The markdown table: one row per command, its short aliases as `!alias` and what they run. */
function tableFor(table, lang) {
  const byCommand = new Map();
  for (const [alias, target] of Object.entries(table)) {
    const [command, ...rest] = target.split(' ');
    if (!byCommand.has(command)) byCommand.set(command, []);
    byCommand.get(command).push({ alias, sub: rest.join(' ') });
  }
  const [head1, head2] = HEADERS[lang];
  const rows = [...byCommand.keys()].sort().map((command) => {
    const cell = byCommand.get(command)
      .sort((a, b) => a.alias.localeCompare(b.alias))
      .map(({ alias, sub }) => (sub ? `\`!${alias}\` ${sub}` : `\`!${alias}\``))
      .join(' · ');
    return `| \`!${command}\` | ${cell} |`;
  });
  return [`| ${head1} | ${head2} |`, '| --- | --- |', ...rows].join('\n');
}

function writeWiki(wikiPath, table) {
  if (!wikiPath || !fs.existsSync(wikiPath)) throw new Error(`Wiki folder not found: ${wikiPath}`);
  for (const lang of ['', 'es', 'pt-br']) {
    const file = path.join(wikiPath, lang, 'setup', 'short-aliases.mdx');
    if (!fs.existsSync(file)) { console.log(`skipped ${file}: the page does not exist yet`); continue; }
    const text = fs.readFileSync(file, 'utf8');
    const from = text.indexOf(START);
    const to = text.indexOf(END);
    if (from < 0 || to < from) throw new Error(`${file} has no ${START} ... ${END} marks`);
    const next = `${text.slice(0, from + START.length)}\n\n${tableFor(table, lang)}\n\n${text.slice(to)}`;
    if (next !== text) fs.writeFileSync(file, next);
    console.log(`wrote ${file}`);
  }
}

module.exports = { writeWiki, tableFor, START, END };
