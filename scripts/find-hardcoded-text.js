// Finds English text written straight into the code: string literals that read like something a member or the staff sees.
// Used by scripts/check-i18n.js on the folders that are translated, and by hand while translating:
//   node scripts/find-hardcoded-text.js src/commands/moderation/ban.js src/utils/caseCard.js
// A line that must stay in English (a log for the team, a name that is never translated...) carries `i18n-ignore` in a comment
// on that line or the line before it; a whole file that nobody outside the team reads starts with `// i18n-ignore-file: <why>`.
const fs = require('node:fs');
const path = require('node:path');

/** The string literals of a JavaScript source, with their line: { line, text, before } (`${...}` becomes `{}`). */
function literalsOf(source) {
  const found = [];
  let i = 0;
  let line = 1;
  let lastSignificant = '';
  const n = source.length;
  const lineStartOf = (index) => source.lastIndexOf('\n', index - 1) + 1;

  function readQuoted(quote) {
    const startLine = line;
    const start = i;
    i += 1;
    let text = '';
    while (i < n && source[i] !== quote) {
      if (source[i] === '\\') { text += source[i + 1] === 'n' ? '\n' : source[i + 1]; i += 2; continue; }
      if (source[i] === '\n') { line += 1; break; } // unterminated: give up on this one
      text += source[i];
      i += 1;
    }
    i += 1;
    found.push({ line: startLine, text, before: source.slice(lineStartOf(start), start) });
  }

  function readTemplate() {
    const startLine = line;
    const start = i;
    i += 1;
    let text = '';
    while (i < n && source[i] !== '`') {
      if (source[i] === '\\') { text += source[i + 1] === 'n' ? '\n' : source[i + 1]; i += 2; continue; }
      if (source[i] === '$' && source[i + 1] === '{') {
        i += 2;
        skipExpression();
        text += '{}';
        continue;
      }
      if (source[i] === '\n') line += 1;
      text += source[i];
      i += 1;
    }
    i += 1;
    found.push({ line: startLine, text, before: source.slice(lineStartOf(start), start) });
  }

  // Inside `${ ... }`: strings and templates in it are read too, braces are counted.
  function skipExpression() {
    let depth = 1;
    while (i < n && depth > 0) {
      const c = source[i];
      if (c === '{') { depth += 1; i += 1; continue; }
      if (c === '}') { depth -= 1; i += 1; continue; }
      if (c === '\'' || c === '"') { readQuoted(c); continue; }
      if (c === '`') { readTemplate(); continue; }
      if (c === '\n') line += 1;
      i += 1;
    }
  }

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === '/' && next === '/') { while (i < n && source[i] !== '\n') i += 1; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { if (source[i] === '\n') line += 1; i += 1; }
      i += 2;
      continue;
    }
    if (c === '\'' || c === '"') { readQuoted(c); lastSignificant = 'x'; continue; }
    if (c === '`') { readTemplate(); lastSignificant = 'x'; continue; }
    if (c === '/' && (lastSignificant === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSignificant) || /\b(return|typeof|case|in|of)\s*$/.test(source.slice(Math.max(0, i - 8), i)))) {
      // A regular expression literal.
      i += 1;
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '/' && !inClass) break;
        i += 1;
      }
      i += 1;
      while (i < n && /[a-z]/i.test(source[i])) i += 1;
      lastSignificant = 'x';
      continue;
    }
    if (!/\s/.test(c)) lastSignificant = c;
    i += 1;
  }
  return found;
}

// Where a single word is already something people read: a button, a field name, a title.
const SINK = /(?:\.set(?:Label|Placeholder|Title|Author|Footer|Content)\(\s*|\b(?:label|placeholder|title|name|header|footer|emptyText|empty|heading|text)\s*:\s*)$/;
const SKIP_LINE = /\blogger\.|\bconsole\.|\brequire\(|i18n-ignore|\bt\(|\.setCustomId\(|customId\s*:|\.startsWith\(|\.endsWith\(|\.includes\(|\bcase\s+['"`]|\.(?:from|select|eq|neq|in|is|order|upsert|rpc)\(/;
const NOT_TEXT = [
  /^\s*$/,
  /^[\w.:/#@<>{}[\]|-]+$/, // ids, keys, paths, custom ids, mentions without spaces
  /^https?:\/\//,
  /^(?:select|insert|update|delete|create|alter|drop|with|on conflict)\b/i,
  /^[a-z_]+(?:\s*,\s*[a-z_]+)+$/, // column lists
  /^[\d\s.,:%+\-*/x()]+$/,
  /^use strict$/,
];

/** Literals of `source` that look like English for people: { line, text }. */
function hardcodedText(source) {
  const lines = source.split('\n');
  if (/^\s*\/\/\s*i18n-ignore-file\b/m.test(lines.slice(0, 5).join('\n'))) return [];
  const hits = [];
  for (const literal of literalsOf(source)) {
    const lineText = lines[literal.line - 1] ?? '';
    const previous = lines[literal.line - 2] ?? '';
    if (SKIP_LINE.test(lineText) || /i18n-ignore/.test(previous)) continue;
    const text = literal.text;
    if (NOT_TEXT.some((pattern) => pattern.test(text.trim()))) {
      // A single capitalized word is still text where people read it ("Close" on a button, "Reason:" before a value).
      const word = /^[A-Z][a-z]{2,}(?:[ -][A-Za-z]+)*[.!?…:]*$/.test(text.trim().replace(/\*\*/g, ''));
      if (!word || !(SINK.test(literal.before) || /:(\*\*)?$/.test(text.trim()))) continue;
    }
    const words = text.replace(/\{\}/g, ' ').match(/[A-Za-z][a-z']{1,}/g) ?? [];
    const sentence = words.length >= 2 && /[a-z]{3,}/.test(text) && /\s/.test(text.trim());
    const single = SINK.test(literal.before) && /^[A-Z][a-z]{2,}/.test(text.trim());
    // "Members: {}", "**Reason:** {}": a label in front of a value.
    const label = /(^|\n)[\s>*_#-]*[A-Z][a-z]+(?: [A-Za-z]+)*:(?:\*\*)?(?:\s|$)/.test(text);
    if (!sentence && !single && !label) continue;
    if (/^[a-z][\w-]*(\.[\w-]+)+$/.test(text)) continue; // a translation key
    hits.push({ line: literal.line, text: text.length > 120 ? `${text.slice(0, 117)}...` : text });
  }
  return hits;
}

function filesUnder(entry) {
  const absolute = path.resolve(entry);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return absolute.endsWith('.js') ? [absolute] : [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((child) => filesUnder(path.join(absolute, child.name)));
}

module.exports = { literalsOf, hardcodedText, filesUnder };

if (require.main === module) {
  const targets = process.argv.slice(2);
  process.env.DISCORD_TOKEN ||= 'check-only';
  process.env.DISCORD_CLIENT_ID ||= '1';
  process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
  if (!targets.length) {
    console.error('Usage: node scripts/find-hardcoded-text.js <file or folder>...');
    process.exit(2);
  }
  // The descriptions and choices of the command builders are translated through the cmd.<category> catalogs, not here.
  const ignored = require('./i18n-commands').builderTexts();
  let total = 0;
  const counts = [];
  for (const file of targets.flatMap(filesUnder)) {
    const hits = hardcodedText(fs.readFileSync(file, 'utf8')).filter((hit) => !ignored.has(hit.text));
    if (!hits.length) continue;
    total += hits.length;
    counts.push([path.relative(process.cwd(), file), hits.length]);
    if (!process.env.SUMMARY) for (const hit of hits) console.log(`${path.relative(process.cwd(), file)}:${hit.line}: ${JSON.stringify(hit.text)}`);
  }
  if (process.env.SUMMARY) for (const [file, count] of counts.sort((a, b) => b[1] - a[1])) console.log(`${count}\t${file}`);
  console.log(`${total} possible hard-coded text(s).`);
}
