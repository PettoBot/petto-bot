// Finds English text written straight into the code: string literals that read like something a member or the staff sees.
// Used by scripts/check-i18n.js on the folders that are translated, and by hand while translating:
//   node scripts/find-hardcoded-text.js src/commands/moderation/ban.js src/utils/caseCard.js
// A line that must stay in English (a log for the team, a name that is never translated...) carries `i18n-ignore` in a comment
// on that line or the line before it; a whole file that nobody outside the team reads starts with `// i18n-ignore-file: <why>`.
//
// Each literal is read with where it sits: the call it is an argument of (and which argument), or the object key it is the value
// of. That is what makes a single word count ("Close" in `.setLabel('Close')` or `{ label: 'Close' }`), and what lets the
// arguments that are never text (`t(lang, 'key')`, `.includes('x')`, `logger.info(...)`, a customId) be left alone without
// skipping the whole line they are on.
const fs = require('node:fs');
const path = require('node:path');

/**
 * The string literals of a JavaScript (or TypeScript) source: { line, text, before, call, arg, key }. `${...}` becomes `{}`.
 * `call` is the name of the innermost call the literal is an argument of (`setLabel`, `t`, `logger.info`…) and `arg` its
 * position; `key` is the object key it is the value of, when the innermost bracket around it is an object.
 */
function literalsOf(source) {
  const found = [];
  let i = 0;
  let line = 1;
  let lastSignificant = '';
  const n = source.length;
  const lineStartOf = (index) => source.lastIndexOf('\n', index - 1) + 1;
  // Open brackets: { type: '(' | '{' | '[', name (for calls), arg (commas seen) }.
  const stack = [];

  function context(start) {
    const top = stack[stack.length - 1];
    const before = source.slice(lineStartOf(start), start);
    const keyMatch = /([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:\s*$/.exec(before);
    // The callee for a literal that is inside an object passed to a call, like `.setFooter({ text: '…' })`.
    const outer = top?.type === '{' ? stack[stack.length - 2] : null;
    return {
      before,
      call: top?.type === '(' ? top.name : null,
      arg: top?.type === '(' ? top.arg : null,
      key: top?.type === '{' && keyMatch ? keyMatch[1].replace(/^['"]|['"]$/g, '') : null,
      outerCall: outer?.type === '(' ? outer.name : null,
    };
  }

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
    found.push({ line: startLine, text, ...context(start) });
  }

  function readTemplate() {
    const startLine = line;
    const start = i;
    const where = context(start);
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
    found.push({ line: startLine, text, ...where });
  }

  // Inside `${ ... }`: strings and templates in it are read too, braces are counted.
  function skipExpression() {
    let depth = 1;
    const base = stack.length;
    while (i < n && depth > 0) {
      const c = source[i];
      if (c === '{') { depth += 1; i += 1; continue; }
      if (c === '}') { depth -= 1; i += 1; continue; }
      if (c === '\'' || c === '"') { readQuoted(c); continue; }
      if (c === '`') { readTemplate(); continue; }
      if (c === '(') { stack.push({ type: '(', name: calleeBefore(i), arg: 0 }); i += 1; continue; }
      if (c === ')') { if (stack.length > base) stack.pop(); i += 1; continue; }
      if (c === ',' && stack.length > base && stack[stack.length - 1].type === '(') stack[stack.length - 1].arg += 1;
      if (c === '\n') line += 1;
      i += 1;
    }
    stack.length = base;
  }

  // The name right before an opening parenthesis: `a.b.setLabel`, `t`, `new Error` -> `Error`.
  function calleeBefore(index) {
    const head = source.slice(Math.max(0, index - 80), index);
    const match = /([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*$/.exec(head);
    return match ? match[1].replace(/\s+/g, '').replace(/\?\./g, '.') : '';
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
    if (c === '(') stack.push({ type: '(', name: calleeBefore(i), arg: 0 });
    else if (c === '{') stack.push({ type: '{' });
    else if (c === '[') stack.push({ type: '[' });
    else if (c === ')' || c === '}' || c === ']') stack.pop();
    else if (c === ',' && stack.length && stack[stack.length - 1].type === '(') stack[stack.length - 1].arg += 1;
    if (!/\s/.test(c)) lastSignificant = c;
    i += 1;
  }
  return found;
}

// Calls whose string arguments are never text people read (the last part of the name).
const NOT_TEXT_CALLS = new Set([
  'require', 'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'split', 'match', 'matchAll', 'test',
  'has', 'get', 'delete', 'from', 'select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'upsert', 'rpc', 'on', 'once', 'off', 'emit',
  'query', 'setCustomId', 'setURL', 'setImage', 'setThumbnail', 'setColor', 'setEmoji', 'setStyle', 'setName',
  'getString', 'getInteger', 'getNumber', 'getBoolean', 'getUser', 'getMember', 'getRole', 'getChannel', 'getMentionable', 'getAttachment',
  'getSubcommand', 'getSubcommandGroup', 'getFocused', 'RegExp', 'Symbol', 'parseInt', 'parseFloat', 'createHash', 'createHmac', 'digest',
  'toString', 'padStart', 'padEnd', 'localeCompare', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toLocaleLowerCase',
  'toLocaleUpperCase', 'DateTimeFormat', 'NumberFormat', 'PluralRules', 'stringify', 'defineProperty', 'hasOwn', 'hasOwnProperty',
  'readFileSync', 'writeFileSync', 'existsSync', 'dirname', 'basename', 'extname', 'registerFromPath', 'loadImage', 'fetch',
  'setHeader', 'header', 'status', 'envBool', 'envList', 'envInt', 'encodeURIComponent', 'decodeURIComponent', 'addChannelTypes',
  'setRequired', 'setMinValue', 'setMaxValue', 'setMinLength', 'setMaxLength', 'setDMPermission', 'setDefaultMemberPermissions',
  'setContexts', 'setIntegrationTypes', 'resolveRole', 'tokenize', 'canvasFont', 'font',
  'commandRef', 'commandMention', 'commandSubcommandMention',
]);
// Calls whose string arguments are what people read: a single word there is already text.
const TEXT_CALLS = new Set(['setLabel', 'setPlaceholder', 'setTitle', 'setDescription', 'setContent', 'setFooter', 'setAuthor', 'addField', 'reply', 'editReply', 'followUp', 'send', 'update', 'textCard', 'plainCard', 'noticePayload']);
// Object keys whose values people read; `name` and `value` only count when they look like words for people (capitalized).
const TEXT_KEYS = new Set(['label', 'placeholder', 'title', 'description', 'desc', 'text', 'footer', 'header', 'content', 'heading', 'emptyText', 'empty', 'subtitle', 'summary', 'message', 'hint', 'note', 'question', 'answer']);
const NAME_KEYS = new Set(['name', 'value']);
// Object keys whose values are never text people read.
const NOT_TEXT_KEYS = new Set(['customId', 'custom_id', 'url', 'iconURL', 'icon_url', 'proxyURL', 'emoji', 'type', 'style', 'key', 'id', 'event', 'table', 'column', 'columns', 'channel', 'kind', 'mode', 'action', 'permission', 'flag', 'flags', 'code', 'format', 'locale', 'lang', 'language', 'font', 'family', 'path', 'file', 'src', 'href', 'method', 'route', 'command', 'commandName', 'subcommand', 'option', 'alias', 'aliases', 'prefix', 'pattern', 'regex', 'unit', 'units', 'color', 'colour', 'tone', 'status', 'state', 'reaction', 'trigger', 'match_mode', 'matchMode', 'onConflict', 'returning', 'parse', 'repliedUser', 'extension', 'size', 'contentType', 'encoding', 'sql', 'usage', 'syntax', 'example', 'examples']);

const NOT_TEXT = [
  /^\s*$/,
  /^[\w.:/#@<>{}[\]|-]+$/, // ids, keys, paths, custom ids, mentions without spaces
  /^https?:\/\//,
  /^(?:select|insert|update|delete|create|alter|drop|with|on conflict)\b/i,
  /^[a-z_]+(?:\s*,\s*[a-z_]+)+$/, // column lists
  /^[\d\s.,:%+\-*/x()]+$/,
  /^use strict$/,
];

const lastPart = (name) => String(name ?? '').split('.').pop();

/** Whether a literal, where it sits, reads like English for people. */
function isHardcoded(literal) {
  const text = literal.text;
  const trimmed = text.trim();
  const call = lastPart(literal.call);
  // Arguments that are never text: the key of `t(lang, 'key')`, logs, ids, comparisons, parsing.
  if ((call === 't' || call === 'tn') && literal.arg === 1) return false;
  if (/^(logger|console)\./.test(literal.call ?? '') || /^(logger|console)\./.test(literal.outerCall ?? '') || literal.call === 'reportInteractionError' || literal.outerCall === 'reportInteractionError') return false;
  if (literal.call && NOT_TEXT_CALLS.has(call) && !literal.key) return false;
  if (literal.key && NOT_TEXT_KEYS.has(literal.key)) return false;
  if (/\bcase\s+$/.test(literal.before) || /(?:===?|!==?)\s*$/.test(literal.before)) return false;
  if (/^[a-z][\w-]*(\.[\w-]+)+$/.test(text)) return false; // a translation key

  // Placeholders (`{user.name}`, `{}`) are not words.
  const words = text.replace(/\{[^{}\s]*\}/g, ' ').match(/[A-Za-z][a-z']{1,}/g) ?? [];
  // A text argument is the first one or two (`reply(interaction, 'text')`); later ones are kinds, colors, options.
  const textCall = (TEXT_CALLS.has(call) && (literal.arg ?? 0) <= 1) || TEXT_CALLS.has(lastPart(literal.outerCall));
  const textKey = literal.key && TEXT_KEYS.has(literal.key);
  const nameKey = literal.key && NAME_KEYS.has(literal.key);

  if (NOT_TEXT.some((pattern) => pattern.test(trimmed))) {
    // A single word is still text where people read it ("Close" on a button, "Reason:" before a value).
    const plain = trimmed.replace(/\*\*/g, '');
    const capitalWord = /^[A-Z][a-z]{2,}(?:[ -][A-Za-z]+)*[.!?…:]*$/.test(plain);
    const anyWord = /^[A-Za-z][a-z]{2,}[.!?…:]*$/.test(plain) && !/[_/:#@<>{}]/.test(plain.replace(/[.!?…:]+$/, ''));
    if (((textCall || (textKey && !literal.call)) && anyWord) || (textKey && capitalWord)) return true;
    if (nameKey && capitalWord) return true;
    if (capitalWord && /:(\*\*)?$/.test(trimmed)) return true;
    return false;
  }
  const sentence = words.length >= 2 && /[a-z]{3,}/.test(text.replace(/\{[^{}\s]*\}/g, ' ')) && /\s/.test(trimmed);
  const single = (textCall || textKey || nameKey) && /^[A-Z][a-z]{2,}/.test(trimmed);
  // "Members: {}", "**Reason:** {}": a label in front of a value.
  const label = /(^|\n)[\s>*_#-]*[A-Z][a-z]+(?: [A-Za-z]+)*:(?:\*\*)?(?:\s|$)/.test(text);
  return sentence || single || label;
}

/** Literals of `source` that look like English for people: { line, text }. */
function hardcodedText(source) {
  const lines = source.split('\n');
  if (/^\s*\/\/\s*i18n-ignore-file\b/m.test(lines.slice(0, 5).join('\n'))) return [];
  const hits = [];
  for (const literal of literalsOf(source)) {
    const lineText = lines[literal.line - 1] ?? '';
    const previous = lines[literal.line - 2] ?? '';
    if (/i18n-ignore/.test(lineText) || /i18n-ignore/.test(previous)) continue;
    if (/\blogger\.\w+\(|\bconsole\.\w+\(|\breportInteractionError\(|\brequire\(/.test(lineText) && !/\bt\(/.test(lineText)) continue;
    if (!isHardcoded(literal)) continue;
    hits.push({ line: literal.line, text: literal.text.length > 120 ? `${literal.text.slice(0, 117)}...` : literal.text });
  }
  return hits;
}

function filesUnder(entry) {
  const absolute = path.resolve(entry);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return /\.(js|ts)$/.test(absolute) && !absolute.endsWith('.d.ts') ? [absolute] : [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((child) => filesUnder(path.join(absolute, child.name))).filter((file) => file.endsWith('.js') || fs.statSync(path.resolve(entry)).isFile());
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
