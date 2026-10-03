const { PettoCodeError } = require('./errors');

const KEYWORDS = new Set(['if', 'else', 'end', 'range', 'with', 'break', 'continue', 'return']);

/** Line and column (both from 1) of an offset in the source. */
function locate(source, offset) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === '\n') { line += 1; column = 1; } else column += 1;
  }
  return { line, column };
}

/**
 * Splits the source into text and actions. Text is what is outside `{{ }}`; `{{-` and `-}}` take away the white space
 * next to an action, and `{{/* ... *\/}}` is a comment.
 */
function splitActions(source) {
  const parts = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('{{', index);
    if (open === -1) { parts.push({ type: 'text', value: source.slice(index), offset: index }); break; }
    if (open > index) parts.push({ type: 'text', value: source.slice(index, open), offset: index });
    let bodyStart = open + 2;
    let trimBefore = false;
    if (source[bodyStart] === '-' && /\s/.test(source[bodyStart + 1] ?? '')) { trimBefore = true; bodyStart += 1; }
    // A comment may hold `}}` in its text, so it ends at `*/}}`.
    let commentAt = bodyStart;
    while (/\s/.test(source[commentAt] ?? '') && commentAt < source.length) commentAt += 1;
    if (source.startsWith('/*', commentAt)) {
      const endComment = source.indexOf('*/', commentAt + 2);
      if (endComment === -1) throw new PettoCodeError('syntax', 'A comment is never closed', locate(source, open));
      const closeAt = source.indexOf('}}', endComment + 2);
      const between = closeAt === -1 ? 'x' : source.slice(endComment + 2, closeAt).trim();
      if (closeAt === -1 || (between !== '' && between !== '-')) throw new PettoCodeError('syntax', 'A comment must end with */}}', locate(source, open));
      parts.push({ type: 'comment', trimBefore, trimAfter: between === '-', offset: open });
      index = closeAt + 2;
      continue;
    }
    let close = -1;
    let quote = null;
    for (let i = bodyStart; i < source.length; i += 1) {
      const char = source[i];
      if (quote) {
        if (char === '\\' && quote !== '`') i += 1;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === '`') quote = char;
      else if (char === '}' && source[i + 1] === '}') { close = i; break; }
    }
    if (close === -1) throw new PettoCodeError('syntax', 'An action is never closed, a }} is missing', locate(source, open));
    let body = source.slice(bodyStart, close);
    let trimAfter = false;
    if (/\s-$/.test(body)) { trimAfter = true; body = body.slice(0, -1); }
    parts.push({ type: 'action', body, bodyOffset: bodyStart, trimBefore, trimAfter, offset: open });
    index = close + 2;
  }
  // Apply the trims to the text next to the actions.
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.type === 'text') continue;
    if (part.trimBefore && parts[i - 1]?.type === 'text') parts[i - 1].value = parts[i - 1].value.replace(/\s+$/, '');
    if (part.trimAfter && parts[i + 1]?.type === 'text') parts[i + 1].value = parts[i + 1].value.replace(/^\s+/, '');
  }
  return parts.filter((part) => part.type === 'action' || (part.type === 'text' && part.value !== ''));
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };

/** The tokens of the inside of one action. */
function tokenize(body, source, bodyOffset) {
  const tokens = [];
  const at = (i) => locate(source, bodyOffset + i);
  let i = 0;
  while (i < body.length) {
    const char = body[i];
    if (/\s/.test(char)) { i += 1; continue; }
    const start = i;
    // `adjacent`: nothing between this token and the one before, so `.A.B` is one path and `.A .B` are two values.
    const push = (type, value) => tokens.push({ type, value, start, adjacent: tokens.length > 0 && tokens[tokens.length - 1].end === start, ...at(start) });
    if (char === '"') {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= body.length) throw new PettoCodeError('syntax', 'A string is never closed', at(start));
        if (body[i] === '"') { i += 1; break; }
        if (body[i] === '\\') {
          const next = body[i + 1];
          if (!(next in ESCAPES)) throw new PettoCodeError('syntax', `Unknown escape \\${next ?? ''} in a string`, at(i));
          value += ESCAPES[next]; i += 2;
        } else { value += body[i]; i += 1; }
      }
      push('string', value);
    } else if (char === '`') {
      const end = body.indexOf('`', i + 1);
      if (end === -1) throw new PettoCodeError('syntax', 'A raw string is never closed', at(start));
      push('string', body.slice(i + 1, end));
      i = end + 1;
    } else if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(body[i + 1] ?? ''))) {
      const match = /^-?\d+(\.\d+)?/.exec(body.slice(i));
      const number = Number(match[0]);
      if (Number.isInteger(number) && !Number.isSafeInteger(number)) throw new PettoCodeError('syntax', 'A number this big loses its last digits. Write an ID inside quotes, like "123456789012345678"', at(start));
      push('number', number);
      i += match[0].length;
    } else if (char === '$') {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(body.slice(i)) ?? /^\$/.exec(body.slice(i));
      push('variable', match[0]);
      i += match[0].length;
    } else if (char === '.') {
      const match = /^\.[A-Za-z_][A-Za-z0-9_]*/.exec(body.slice(i));
      if (match) { push('field', match[0].slice(1)); i += match[0].length; } else { push('dot', '.'); i += 1; }
    } else if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(body.slice(i))[0];
      i += match.length;
      if (match === 'true' || match === 'false') push('bool', match === 'true');
      else if (match === 'nil') push('nil', null);
      else if (KEYWORDS.has(match)) push('keyword', match);
      else push('ident', match);
    } else if (char === ':' && body[i + 1] === '=') { push('declare', ':='); i += 2; }
    else if (char === '=') { push('assign', '='); i += 1; }
    else if (char === '(' || char === ')' || char === '|' || char === ',') { push(char === '(' ? 'lparen' : char === ')' ? 'rparen' : char === '|' ? 'pipe' : 'comma', char); i += 1; }
    else throw new PettoCodeError('syntax', `Unexpected character ${JSON.stringify(char)}`, at(i));
    tokens[tokens.length - 1].end = i;
  }
  return tokens;
}

module.exports = { splitActions, tokenize, locate };
