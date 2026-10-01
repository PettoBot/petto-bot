// Checks the dice parser and roller of the roll command with fixed dice, and that bad input is refused with a message.
const assert = require('node:assert/strict');
const { DiceError, parseDice, rollDice, describeTerm } = require('../src/utils/dice');

const sequence = (...values) => {
  let index = 0;
  return () => values[index++ % values.length];
};

// Plain dice and modifiers.
let result = rollDice('2d6+3', sequence(4, 5));
assert.equal(result.total, 12);
assert.equal(result.min, 5);
assert.equal(result.max, 15);
assert.equal(rollDice('d20', sequence(17)).total, 17);
assert.equal(rollDice('D20', sequence(17)).total, 17, 'case-insensitive');
assert.equal(rollDice(' 1d4 + 2 - 1 ', sequence(3)).total, 4, 'spaces are ignored');
assert.equal(rollDice('3d6-2', sequence(1, 2, 3)).total, 4);
assert.equal(rollDice('2d4-1d4', sequence(4, 4, 3)).total, 5, 'a subtracted die is subtracted');
assert.equal(rollDice('2d4-1d4', sequence(4, 4, 3)).min, 2 - 4);

// Keep highest / lowest, the usual ability score roll.
result = rollDice('4d6kh3', sequence(6, 1, 5, 4));
assert.equal(result.total, 15);
assert.deepEqual(result.terms[0].kept.sort(), [0, 2, 3]);
assert.equal(rollDice('2d20kl1', sequence(15, 8)).total, 8);
assert.equal(rollDice('2d20kh1', sequence(15, 8)).total, 15);
assert.equal(rollDice('3d6kh2', sequence(4, 4, 4)).total, 8, 'ties keep earlier rolls and still count the right number');

// The text shows which dice were dropped.
assert.equal(describeTerm(rollDice('4d6kh3', sequence(6, 1, 5, 4)).terms[0]), '4d6kh3 [**6**, ~~1~~, **5**, **4**]');
assert.equal(describeTerm(rollDice('+7+d2', sequence(2)).terms[0]), '7');

// Real randomness stays inside the range.
for (let i = 0; i < 200; i += 1) {
  const rolled = rollDice('3d8+1');
  assert.ok(rolled.total >= rolled.min && rolled.total <= rolled.max);
  assert.equal(rolled.min, 4);
  assert.equal(rolled.max, 25);
}

// Refusals.
const refuses = (text, pattern) => assert.throws(() => parseDice(text), (error) => error instanceof DiceError && pattern.test(error.message), `expected a refusal for ${JSON.stringify(text)}`);
refuses('', /Say what to roll/);
refuses('hello', /do not understand/);
refuses('5', /at least one die/);
refuses('d1', /between 2 and/);
refuses('d1001', /between 2 and/);
refuses('0d6', /between 1 and/);
refuses('101d6', /between 1 and/);
refuses('4d6kh5', /keeps 5 of 4/);
refuses('4d6kh0', /keeps 0 of 4/);
refuses('2d6++3', /stray/);
refuses('2d6+', /stray/);
refuses('d6+d6+d6+d6+d6+d6+d6+d6+d6+d6+d6', /at most 10 terms/);
refuses('100d6+100d6+1d6', /more than 200 dice/);
refuses('d6+999999999', /larger than/);
refuses('2d6x3', /do not understand/);

console.log('Checked the dice parser and roller.');
