// The small games that post a question for the channel (`!wouldyourather`, `!neverhaveiever`, `!truthordare`) and the coin.
// The prompts are in the fun catalog (`fun.wyr.<n>.a`, `fun.nhie.<n>`, `fun.truth.<n>`, `fun.dare.<n>`, in every language) and
// the counts here say how many there are (scripts/check-fun-extras.js checks that every language has all of them).
const { randomInt } = require('node:crypto');
const { escapeMarkdown } = require('discord.js');

const PROMPT_COUNTS = { wyr: 12, nhie: 12, truth: 10, dare: 10 };
const ZERO_WIDTH = '​';

// The words that mean truth or dare, in English, Spanish and Portuguese (read, never shown).
const TOD_WORDS = new Map([
  ...['truth', 't', 'verdad', 'verdade', 'v'].map((word) => [word, 'truth']),
  ...['dare', 'd', 'reto', 'desafio', 'r'].map((word) => [word, 'dare']),
]);

/** `truth` or `dare` for what a member typed, or null. */
function readTruthOrDare(text) {
  return TOD_WORDS.get(String(text ?? '').trim().toLowerCase()) ?? null;
}

/** A number from 1 to `PROMPT_COUNTS[kind]`; `random(min, maxExclusive)` can be replaced in tests. */
function pickPromptNumber(kind, random = randomInt) {
  const count = PROMPT_COUNTS[kind];
  if (!count) throw new RangeError(`Unknown prompt kind "${kind}"`); // i18n-ignore: internal error, never shown
  return random(1, count + 1);
}

/** `heads` or `tails`; `random(min, maxExclusive)` can be replaced in tests. */
function flipCoin(random = randomInt) {
  return random(0, 2) === 0 ? 'heads' : 'tails';
}

/** Two options from "pizza, tacos" (see parseChoices in funGames), or null when there are not exactly two. */
function readTwoOptions(options) {
  return options.length === 2 ? options : null;
}

/**
 * Text written by a member, safe to put in a message: Markdown is escaped, `@everyone`, `@here` and mentions are broken with an
 * invisible character (the message also sends with no mentions allowed), and it is cut to `max` characters.
 */
function plainText(text, max = 150) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const cut = flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
  return escapeMarkdown(cut)
    .replace(/@(everyone|here)/gi, `@${ZERO_WIDTH}$1`)
    .replace(/<(@[!&]?|#|\/)/g, `<${ZERO_WIDTH}$1`);
}

module.exports = { PROMPT_COUNTS, readTruthOrDare, pickPromptNumber, flipCoin, readTwoOptions, plainText };
