// Logic behind the small fun commands (8ball, ship, rps, choose). Free of Discord so scripts/check-fun.js can test it.
const { createHash, randomInt } = require('node:crypto');
const { escapeMarkdown } = require('discord.js');
const { t, currentLanguage } = require('../i18n');

// The 20 answers (10 yes, 5 maybe, 5 no); their texts are in the fun catalog and `text` is the English one.
const EIGHT_BALL_ANSWERS = [
  { tone: 'yes', key: 'fun.eightBall.certain' },
  { tone: 'yes', key: 'fun.eightBall.noDoubt' },
  { tone: 'yes', key: 'fun.eightBall.definitely' },
  { tone: 'yes', key: 'fun.eightBall.relyOnIt' },
  { tone: 'yes', key: 'fun.eightBall.asISeeIt' },
  { tone: 'yes', key: 'fun.eightBall.mostLikely' },
  { tone: 'yes', key: 'fun.eightBall.outlookGood' },
  { tone: 'yes', key: 'fun.eightBall.yes' },
  { tone: 'yes', key: 'fun.eightBall.signsYes' },
  { tone: 'yes', key: 'fun.eightBall.starsAgree' },
  { tone: 'maybe', key: 'fun.eightBall.hazy' },
  { tone: 'maybe', key: 'fun.eightBall.askLater' },
  { tone: 'maybe', key: 'fun.eightBall.betterNotTell' },
  { tone: 'maybe', key: 'fun.eightBall.cannotPredict' },
  { tone: 'maybe', key: 'fun.eightBall.concentrate' },
  { tone: 'no', key: 'fun.eightBall.dontCount' },
  { tone: 'no', key: 'fun.eightBall.replyNo' },
  { tone: 'no', key: 'fun.eightBall.sourcesNo' },
  { tone: 'no', key: 'fun.eightBall.outlookNotGood' },
  { tone: 'no', key: 'fun.eightBall.veryDoubtful' },
].map((answer) => ({ ...answer, text: t('en', answer.key) }));

const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const RPS_ICON = { rock: '✊', paper: '✋', scissors: '✌️' };
// The words a member can type for each move, in English, Spanish and Portuguese (read, never shown).
const RPS_WORDS = new Map([
  ...['rock', 'piedra', 'pedra'].map((word) => [word, 'rock']),
  ...['paper', 'papel'].map((word) => [word, 'paper']),
  ...['scissors', 'tijera', 'tijeras', 'tesoura', 'tesouras'].map((word) => [word, 'scissors']),
]);

/** The move a member typed (`rock`, `piedra`, `tesoura`…), or null. */
function readRpsChoice(text) {
  return RPS_WORDS.get(String(text ?? '').trim().toLowerCase()) ?? null;
}

/** Picks one entry. `random(min, maxExclusive)` can be replaced in tests. */
function pickRandom(list, random = randomInt) {
  if (!list.length) throw new RangeError('Nothing to pick from.'); // i18n-ignore: internal error, never shown
  return list[random(0, list.length)];
}

/** Picks `count` different entries, in a random order. */
function pickMany(list, count, random = randomInt) {
  const pool = [...list];
  const picked = [];
  while (pool.length && picked.length < count) picked.push(pool.splice(random(0, pool.length), 1)[0]);
  return picked;
}

/** Splits "pizza, tacos or sushi" into its choices: commas, pipes and semicolons first, " or " when there are none. */
function parseChoices(text) {
  const raw = String(text ?? '').trim();
  const parts = /[,|;]/.test(raw) ? raw.split(/[,|;]/) : raw.split(/\s+or\s+/i);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Compatibility from 0 to 100. It only depends on the two ids, in either order, so the same pair always gets the
 * same answer, and a member with themselves gets 100.
 */
function shipScore(idA, idB) {
  if (idA === idB) return 100;
  const [first, second] = [String(idA), String(idB)].sort();
  const digest = createHash('sha256').update(`${first}:${second}`).digest();
  return digest.readUInt32BE(0) % 101;
}

/**
 * The eight steps of a ship result. Each one has a short title (`fun.ship.verdict.*`), two sentences
 * (`fun.ship.line.<id>.1` and `.2`, one of them is picked for each pair) and the heart that opens the message.
 * `look` is the theme the card is drawn with (see src/imgutils/shipCard.js).
 */
const SHIP_TIERS = [
  { id: 'notMeant', min: 0, title: 'fun.ship.verdict.notMeant', heart: '💔', look: 'cold' },
  { id: 'chilly', min: 10, title: 'fun.ship.verdict.chilly', heart: '💙', look: 'cold' },
  { id: 'justFriends', min: 25, title: 'fun.ship.verdict.justFriends', heart: '🤍', look: 'soft' },
  { id: 'withEffort', min: 40, title: 'fun.ship.verdict.withEffort', heart: '💗', look: 'soft' },
  { id: 'goodChemistry', min: 55, title: 'fun.ship.verdict.goodChemistry', heart: '💖', look: 'warm' },
  { id: 'greatMatch', min: 70, title: 'fun.ship.verdict.greatMatch', heart: '💞', look: 'warm' },
  { id: 'sparks', min: 80, title: 'fun.ship.verdict.sparks', heart: '💘', look: 'hot' },
  { id: 'soulmates', min: 90, title: 'fun.ship.verdict.soulmates', heart: '💝', look: 'soulmates' },
];

/** The step of a score from 0 to 100 (anything else is brought into that range). */
function shipTier(score) {
  const value = Math.min(100, Math.max(0, Math.round(Number(score) || 0)));
  let tier = SHIP_TIERS[0];
  for (const candidate of SHIP_TIERS) if (value >= candidate.min) tier = candidate;
  return tier;
}

function shipVerdict(score, lang = currentLanguage()) {
  return t(lang, shipTier(score).title);
}

/** One of the two sentences of the step; the same pair always gets the same one (the order of the ids does not matter). */
function shipLine(score, idA, idB, lang = currentLanguage()) {
  const [first, second] = [String(idA), String(idB)].sort();
  const variant = (createHash('sha256').update(`line:${first}:${second}`).digest()[0] % 2) + 1;
  return t(lang, `fun.ship.line.${shipTier(score).id}.${variant}`);
}

// Emoji, pictographs, flags, joiners and invisible characters: they are not drawn on the card and not part of the ship name.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\p{Cf}\p{Cc}\u20e3]/gu;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemesOf = (text) => Array.from(segmenter.segment(text), (part) => part.segment);

/** A name as it is drawn on the card: without emoji or invisible characters, in one line. Empty when nothing is left. */
function plainName(name) {
  return String(name ?? '').normalize('NFKC').replace(PICTOGRAPHS, '').replace(/\s+/g, ' ').trim();
}

/** The word of a name that is blended: the first one of 3 letters or more, or else the longest one. Only letters and digits. */
function shipWord(name) {
  const cleaned = plainName(name)
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1') // a stack of accents is cut
    .replace(/(^|\s)\p{M}+/gu, '$1');
  const words = cleaned.split(/\s+/).filter(Boolean).map(graphemesOf);
  return words.find((word) => word.length >= 3) ?? words.sort((a, b) => b.length - a.length)[0] ?? [];
}

const isVowel = (letter) => /[aeiouy]/i.test(String(letter ?? '').normalize('NFD')[0]);

/** The second half of the second name, starting at its first vowel from the middle on when that leaves at least 2 letters. */
function tailOf(word) {
  const middle = Math.floor(word.length / 2);
  let start = middle;
  while (start < word.length && !isVowel(word[start])) start += 1;
  if (word.length - start < 2) start = middle;
  return word.slice(Math.max(start, word.length - 10));
}

/**
 * The name of the pair: the first half of the first name with the second half of the second one ("Julian" and "Maria" are
 * "Julria"). It only depends on the two names, so it is always the same one; the emoji and symbols of a nickname are left out, a
 * name of one or two letters is used whole, and when nothing usable is left (or the result is shorter than 3 letters, or has no
 * letter) it is the fallback name of the language.
 */
function shipName(nameA, nameB, lang = currentLanguage()) {
  const first = shipWord(nameA);
  const second = shipWord(nameB);
  const head = first.length <= 2 ? first : first.slice(0, Math.min(10, Math.ceil(first.length / 2)));
  const tail = second.length <= 2 ? second : tailOf(second);
  // Two vowels in a row at the join sound worse than one: the last one of the first half gives way.
  const join = head.length > 1 && isVowel(head[head.length - 1]) && isVowel(tail[0]) ? head.slice(0, -1) : head;
  const blended = [...join, ...tail];
  if (blended.length < 3 || !/\p{L}/u.test(blended.join(''))) return t(lang, 'fun.ship.fallbackName');
  const [initial, ...rest] = blended;
  return initial.toLocaleUpperCase() + rest.join('').toLocaleLowerCase();
}

/**
 * The message above the card: the name of the pair, how compatible they are and the line of the step. `nameA` and `nameB` are shown
 * as they are (markdown is escaped); the ids only choose between the two sentences of the step.
 */
function shipMessage({ idA, idB, nameA, nameB, score, lang = currentLanguage() }) {
  const tier = shipTier(score);
  const shown = (name) => `**${escapeMarkdown(String(name))}**`;
  return [
    `${tier.heart} **${shipName(nameA, nameB, lang)}**`,
    t(lang, 'fun.ship.compat', { a: shown(nameA), b: shown(nameB), score }),
    `**${t(lang, tier.title)}.** ${shipLine(score, idA, idB, lang)}`,
  ].join('\n');
}

function shipBar(score, segments = 10) {
  const filled = Math.round((score / 100) * segments);
  return `${'▰'.repeat(filled)}${'▱'.repeat(segments - filled)}`;
}

/** The result of a rock, paper, scissors round from the player's point of view. */
function rpsOutcome(player, bot) {
  if (!RPS_BEATS[player] || !RPS_BEATS[bot]) throw new RangeError('Unknown rock paper scissors choice.'); // i18n-ignore: internal error, never shown
  if (player === bot) return 'tie';
  return RPS_BEATS[player] === bot ? 'win' : 'lose';
}

module.exports = {
  EIGHT_BALL_ANSWERS,
  RPS_CHOICES,
  RPS_ICON,
  pickRandom,
  pickMany,
  parseChoices,
  shipScore,
  SHIP_TIERS,
  shipTier,
  shipVerdict,
  shipLine,
  plainName,
  shipName,
  shipMessage,
  shipBar,
  rpsOutcome,
  readRpsChoice,
};
