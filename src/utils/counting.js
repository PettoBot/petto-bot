// The counting game: members write the next number, one after the other. This file is the rules, apart from Discord: reading a number
// (or a sum such as 2*3+1 when the server allows it), deciding whether a message is the right one, and what the game keeps afterwards.

const MAX_EXPRESSION = 40;
const MAX_NUMBER = 2_000_000_000;

/**
 * The integer a text says, or null when it is not a number (it is then just chat, and the game leaves it alone). A plain number is read
 * as it is; with `math` a sum such as `2*3+1`, `(4+4)/2` or `2^3` is worked out. Nothing is evaluated as code: a small parser with
 * + - * / ^ and brackets, and a result that is not a whole number counts as nothing.
 */
function readNumber(text, { math = true } = {}) {
  const value = String(text ?? '').trim().replace(/[,_](?=\d{3}\b)/g, '');
  if (/^\d{1,10}$/.test(value)) return Math.min(Number(value), MAX_NUMBER + 1);
  if (!math || value.length > MAX_EXPRESSION || !/^[\d\s+\-*/^()xX×÷.]+$/.test(value) || !/\d\s*[+\-*/^xX×÷]/.test(value) && !/[+\-*/^xX×÷]\s*\d/.test(value)) return null;
  const result = evaluate(value.replace(/[xX×]/g, '*').replace(/÷/g, '/'));
  return Number.isInteger(result) && result >= 0 && result <= MAX_NUMBER ? result : null;
}

/** + - * / ^ and brackets over numbers, by the usual order. Null for anything it cannot read. */
function evaluate(source) {
  const tokens = source.match(/\d+(?:\.\d+)?|[+\-*/^()]/g);
  if (!tokens || tokens.join('').length !== source.replace(/\s+/g, '').length) return null;
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  function primary() {
    const token = take();
    if (token === undefined) throw new Error('end');
    if (token === '(') { const inner = sum(); if (take() !== ')') throw new Error('bracket'); return inner; }
    if (token === '-') return -primary();
    if (/^\d/.test(token)) return Number(token);
    throw new Error('token');
  }
  function power() { const base = primary(); if (peek() === '^') { take(); return base ** power(); } return base; }
  function product() {
    let left = power();
    while (peek() === '*' || peek() === '/') { const op = take(); const right = power(); left = op === '*' ? left * right : left / right; }
    return left;
  }
  function sum() {
    let left = product();
    while (peek() === '+' || peek() === '-') { const op = take(); const right = product(); left = op === '+' ? left + right : left - right; }
    return left;
  }
  try {
    const result = sum();
    return index === tokens.length && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

/**
 * What a message means for the game:
 * - `ignore`: it is not a number, so it is chat;
 * - `ok`: the number that was next, from someone who did not just count;
 * - `double`: the right number, but from the same person as the last one (when that is not allowed);
 * - `wrong`: another number.
 * `expected` is the number that had to come.
 */
function judge({ text, authorId, config }) {
  const number = readNumber(text, { math: config.math });
  if (number === null) return { kind: 'ignore' };
  const expected = Number(config.current_number ?? 0) + 1;
  if (!config.allow_double && config.last_user_id && String(config.last_user_id) === String(authorId)) return { kind: 'double', number, expected };
  return number === expected ? { kind: 'ok', number, expected } : { kind: 'wrong', number, expected };
}

/** After a right number: what changes in the game. */
function afterCorrect(config, number) {
  const record = number > Number(config.high_score ?? 0);
  const earnsSave = config.saves_max > 0 && config.save_every > 0 && number % config.save_every === 0;
  return {
    patch: {
      current_number: number,
      high_score: record ? number : config.high_score,
      total_correct: Number(config.total_correct ?? 0) + 1,
      saves: earnsSave ? Math.min(config.saves_max, Number(config.saves ?? 0) + 1) : Number(config.saves ?? 0),
    },
    record,
    earnedSave: earnsSave && Number(config.saves ?? 0) < config.saves_max,
    milestone: config.milestone_every > 0 && number % config.milestone_every === 0,
  };
}

/** After a wrong number: a save is used if there is one, and otherwise the count goes back to where it starts (when the server resets). */
function afterWrong(config) {
  const saves = Number(config.saves ?? 0);
  if (saves > 0) return { patch: { saves: saves - 1, total_wrong: Number(config.total_wrong ?? 0) + 1 }, saved: true, reset: false };
  const reset = config.reset_on_wrong !== false;
  return {
    patch: { total_wrong: Number(config.total_wrong ?? 0) + 1, ...(reset ? { current_number: Number(config.start_number ?? 0), last_user_id: null } : {}) },
    saved: false,
    reset,
  };
}

/** Deletes a message after `seconds` (nothing when it is 0). Timers that a restart loses just leave the message there. */
function deleteLater(message, seconds) {
  if (!message?.delete || !(seconds > 0)) return;
  setTimeout(() => { message.delete().catch(() => {}); }, Math.min(seconds, 86_400) * 1000).unref?.();
}

/**
 * Who the best counter is after a member's score changed: `{ topUserId, topCorrect, changed }`. The member takes the first place when they have more
 * right numbers than who holds it (or they are the one who holds it and their number grows).
 */
function trackTop(config, userId, correct) {
  const holder = config.top_user_id ? String(config.top_user_id) : null;
  if (holder === String(userId)) return { topUserId: holder, topCorrect: correct, changed: false };
  if (!holder || correct > Number(config.top_correct ?? 0)) return { topUserId: String(userId), topCorrect: correct, changed: true, previous: holder };
  return { topUserId: holder, topCorrect: Number(config.top_correct ?? 0), changed: false };
}

module.exports = { deleteLater, trackTop, MAX_NUMBER, readNumber, evaluate, judge, afterCorrect, afterWrong };
