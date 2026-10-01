// Dice notation for the roll command: `2d6+3`, `d20`, `4d6kh3` (keep the highest 3), `2d20kl1` (keep the lowest 1),
// and several terms added or subtracted. Pure and free of Discord, so scripts/check-dice.js can test it alone.
const { randomInt } = require('node:crypto');

const MAX_DICE_PER_TERM = 100;
const MAX_DICE_TOTAL = 200;
const MAX_SIDES = 1000;
const MAX_TERMS = 10;
const MAX_MODIFIER = 100_000;

class DiceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DiceError';
  }
}

const TERM_RE = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i;

/** Splits `2d6 + 3 - 1d4` into signed terms. Throws a readable DiceError when the text is not dice notation. */
function parseDice(input) {
  const text = String(input ?? '').toLowerCase().replace(/\s+/g, '');
  if (!text) throw new DiceError('Say what to roll, for example `2d6+3` or `d20`.');
  if (!/^[0-9dkhl+-]+$/.test(text)) throw new DiceError(`I do not understand \`${String(input).slice(0, 40)}\`. Use dice like \`2d6+3\`.`);

  const pieces = text.match(/[+-]?[^+-]+/g);
  if (!pieces || pieces.join('') !== text) throw new DiceError('That expression has a stray `+` or `-`.');
  if (pieces.length > MAX_TERMS) throw new DiceError(`Use at most ${MAX_TERMS} terms.`);

  let totalDice = 0;
  const terms = pieces.map((piece) => {
    const sign = piece.startsWith('-') ? -1 : 1;
    const body = piece.replace(/^[+-]/, '');

    if (/^\d+$/.test(body)) {
      const value = Number(body);
      if (value > MAX_MODIFIER) throw new DiceError(`Numbers cannot be larger than ${MAX_MODIFIER}.`);
      return { type: 'number', sign, value };
    }

    const match = TERM_RE.exec(body);
    if (!match) throw new DiceError(`I do not understand \`${body}\`. Use dice like \`2d6\` or \`4d6kh3\`.`);

    const count = match[1] === '' ? 1 : Number(match[1]);
    const sides = Number(match[2]);
    if (count < 1 || count > MAX_DICE_PER_TERM) throw new DiceError(`Roll between 1 and ${MAX_DICE_PER_TERM} dice at a time.`);
    if (sides < 2 || sides > MAX_SIDES) throw new DiceError(`Dice need between 2 and ${MAX_SIDES} sides.`);

    let keep = null;
    if (match[3]) {
      const amount = Number(match[4]);
      if (amount < 1 || amount > count) throw new DiceError(`\`${body}\` keeps ${amount} of ${count} dice; keep between 1 and ${count}.`);
      keep = { mode: match[3] === 'kh' ? 'highest' : 'lowest', amount };
    }

    totalDice += count;
    if (totalDice > MAX_DICE_TOTAL) throw new DiceError(`That is more than ${MAX_DICE_TOTAL} dice in total.`);
    return { type: 'dice', sign, count, sides, keep };
  });

  if (!terms.some((term) => term.type === 'dice')) throw new DiceError('Add at least one die, for example `d20`.');
  return terms;
}

/** Which of a term's rolls count. With `keep`, only the highest or lowest ones; ties keep the earlier roll. */
function keptIndexes(rolls, keep) {
  const all = rolls.map((_, index) => index);
  if (!keep) return new Set(all);
  const ordered = [...all].sort((a, b) => (keep.mode === 'highest' ? rolls[b] - rolls[a] : rolls[a] - rolls[b]) || a - b);
  return new Set(ordered.slice(0, keep.amount));
}

/**
 * Rolls an expression. `random(min, maxExclusive)` is injectable so tests can fix the dice.
 * @returns {{terms: object[], total: number, min: number, max: number}}
 */
function rollDice(input, random = randomInt) {
  const parsed = parseDice(input);
  let total = 0;
  let min = 0;
  let max = 0;

  const terms = parsed.map((term) => {
    if (term.type === 'number') {
      total += term.sign * term.value;
      min += term.sign * term.value;
      max += term.sign * term.value;
      return { ...term, subtotal: term.sign * term.value };
    }

    const rolls = Array.from({ length: term.count }, () => random(1, term.sides + 1));
    const kept = keptIndexes(rolls, term.keep);
    const sum = rolls.reduce((acc, value, index) => acc + (kept.has(index) ? value : 0), 0);
    const diceKept = term.keep ? term.keep.amount : term.count;
    const subtotal = term.sign * sum;

    total += subtotal;
    min += term.sign === 1 ? diceKept : -diceKept * term.sides;
    max += term.sign === 1 ? diceKept * term.sides : -diceKept;
    return { ...term, rolls, kept: [...kept], subtotal };
  });

  return { terms, total, min, max };
}

/** `2d6 [**4**, ~~1~~]` style text for one rolled term. */
function describeTerm(term) {
  if (term.type === 'number') return `${term.value}`;
  const label = `${term.count}d${term.sides}${term.keep ? `${term.keep.mode === 'highest' ? 'kh' : 'kl'}${term.keep.amount}` : ''}`;
  const kept = new Set(term.kept);
  const shown = term.rolls.map((value, index) => (kept.has(index) ? `**${value}**` : `~~${value}~~`));
  return `${label} [${shown.join(', ')}]`;
}

module.exports = { DiceError, parseDice, rollDice, describeTerm, MAX_DICE_TOTAL };
