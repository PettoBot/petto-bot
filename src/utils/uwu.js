// `!uwu`: turns a text into "uwu speak" (soft letters, a little stutter and a small face now and then).
//
// What is left alone: code blocks and inline code, links, mentions (`<@id>`, `<@&id>`, `<#id>`), custom emojis, timestamps,
// `:shortcodes:` and everything that is not a letter (Markdown signs, numbers, emojis). `@everyone` and `@here` get an invisible
// character after the `@`, so they cannot ping even if the message were sent with other rules. The same text always gives the
// same result: the choices (which word stutters, where a face goes) come from a hash of the text, not from chance.
//
// Languages: English softens `l` and `r` (`really` is `weawwy`). Spanish and Portuguese keep their consonants, which would make
// them unreadable, and only soften the `r` that ends a long word and `n` before a vowel (`amor` is `amow`, `nada` is `nyada`).

const MESSAGE_LIMIT = 2000;
const FACES = ['uwu', 'owo', 'nya~', '^w^'];
// The most faces a text gets, however long it is, so it stays readable.
const MAX_FACES = 4;
const ZERO_WIDTH = '​';

// What is never changed (an e-mail address too). An unfinished code block runs to the end of the text.
const PROTECTED = /```[\s\S]*?(?:```|$)|`[^`\n]+`|<[^<>\s]{1,100}>|https?:\/\/[^\s<>]+|www\.[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|@(?:everyone|here)(?![\p{L}\p{N}_])|:[A-Za-z0-9_]{2,32}:/giu;
const WORD = /[\p{L}]+(?:'[\p{L}]+)*/gu;

/** A small stable hash (FNV-1a): the same text always gets the same choices. */
function hash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** The language of the uwu rules for a language of Petto: `en`, `es` or `pt` (everything else is English). */
function uwuLanguage(lang) {
  const value = String(lang ?? 'en').toLowerCase();
  if (value.startsWith('es')) return 'es';
  if (value.startsWith('pt')) return 'pt';
  return 'en';
}

/** `replacement` in the case of `original` (`Na` -> `Nya`, `NA` -> `NYA`). */
function matchCase(original, replacement) {
  if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase()) return replacement.toUpperCase();
  if (original[0] !== original[0].toLowerCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/** `n` before a vowel becomes `ny` (`nada` is `nyada`, `Nada` is `Nyada`, `NADA` is `NYADA`). */
function nyify(word) {
  const loud = word.length > 1 && word === word.toUpperCase();
  return word.replace(/([nN])([aeiouAEIOU])/g, (_, n, vowel) => (n === 'N' ? (loud ? 'NY' : 'Ny') : 'ny') + vowel);
}

function softenEnglish(word) {
  return nyify(word)
    .replace(/ove/g, 'uv')
    .replace(/[lr]/g, 'w')
    .replace(/[LR]/g, 'W');
}

function softenRomance(word) {
  let result = nyify(word);
  // Only a long word that ends in `r` (amor, cantar): the `r` of the middle is part of how the word is read.
  if (word.length >= 4 && /[rR]$/.test(word)) result = result.slice(0, -1) + (word.endsWith('R') ? 'W' : 'w');
  return result;
}

/** One word in uwu: soft letters, and now and then a stutter (`h-hewwo`). */
function uwuWord(word, index, lang) {
  let result = lang === 'en' ? softenEnglish(word) : softenRomance(word);
  const first = result[0];
  // A stutter on about one word in six, only on words that start with a letter of the alphabet and have some length.
  if (/^[A-Za-z]/.test(first) && word.length >= 3 && hash(`${word.toLowerCase()}#${index}`) % 6 === 0) result = `${first}-${result}`;
  return result;
}

function uwuPlain(text, state) {
  const words = text.replace(WORD, (word) => {
    const converted = uwuWord(word, state.words, state.lang);
    state.words += 1;
    return converted;
  });
  // A face after some of the ends of a sentence (about one in three, never more than MAX_FACES in all).
  return words.replace(/([.!?]+)(?=\s|$)/g, (ends, _marks, offset) => {
    state.sentences += 1;
    if (state.faces >= MAX_FACES || hash(`${state.sentences}:${offset}:${ends}`) % 3 !== 0) return ends;
    state.faces += 1;
    return `${ends} ${FACES[hash(`${state.sentences}${ends}`) % FACES.length]}`;
  });
}

/** The pieces of a text: `{ text, plain }`, where `plain` pieces are the ones that are changed. */
function splitText(text) {
  const pieces = [];
  let last = 0;
  for (const match of text.matchAll(PROTECTED)) {
    if (match.index > last) pieces.push({ text: text.slice(last, match.index), plain: true });
    const value = match[0];
    pieces.push({ text: /^@(?:everyone|here)$/i.test(value) ? `@${ZERO_WIDTH}${value.slice(1)}` : value, plain: false });
    last = match.index + value.length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), plain: true });
  return pieces;
}

/** `text` cut to `limit` characters at the end of a word, with `…`, never in the middle of a pair of characters. */
function clipPlain(text, limit) {
  if (limit <= 0) return '';
  let cut = text.slice(0, limit);
  const space = cut.search(/\s\S*$/);
  if (space > 0) cut = cut.slice(0, space);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

/**
 * `text` in uwu speak, at most `limit` characters (Discord's 2000 for a message). A code block or a link that does not fit is left
 * out whole (never cut in half), and a text that is cut ends with `…`. Empty text gives an empty string.
 */
function uwuify(text, { lang = 'en', limit = MESSAGE_LIMIT } = {}) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) return '';
  const state = { lang: uwuLanguage(lang), words: 0, sentences: 0, faces: 0 };
  const pieces = splitText(source).map((piece) => (piece.plain ? { ...piece, text: uwuPlain(piece.text, state) } : piece));

  // A text with no end of sentence still gets one face at its end (unless it ends inside a code block, where it would be code).
  const lastPiece = pieces.at(-1);
  const unfinishedCode = lastPiece?.text.startsWith('```') && !/^```[\s\S]*```$/.test(lastPiece.text);
  if (!state.faces && lastPiece && !unfinishedCode) {
    const face = FACES[hash(source) % FACES.length];
    if (lastPiece.plain) lastPiece.text = `${lastPiece.text.trimEnd()} ${face}`;
    else pieces.push({ text: ` ${face}`, plain: true });
  }

  let output = '';
  for (const piece of pieces) {
    if (output.length + piece.text.length <= limit) {
      output += piece.text;
      continue;
    }
    // Cut: a plain piece is cut at a word, a code block, link or mention is left out whole.
    const room = limit - output.length - 1; // 1 for the …
    const kept = piece.plain ? clipPlain(piece.text, room) : '';
    output = `${output}${kept}`.trimEnd();
    if (output.length >= limit) output = output.slice(0, limit - 1);
    return `${output}…`;
  }
  return output;
}

module.exports = { uwuify, uwuLanguage, hash, MESSAGE_LIMIT, FACES, MAX_FACES };
