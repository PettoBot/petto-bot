// Checks the logic of the fun commands: choosing, 8ball answers, ship scores and rock paper scissors.
const assert = require('node:assert/strict');
const {
  EIGHT_BALL_ANSWERS,
  RPS_CHOICES,
  pickRandom,
  pickMany,
  parseChoices,
  shipScore,
  shipVerdict,
  shipBar,
  rpsOutcome,
} = require('../src/utils/funGames');

// choose
assert.deepEqual(parseChoices('pizza, tacos, sushi'), ['pizza', 'tacos', 'sushi']);
assert.deepEqual(parseChoices('pizza | tacos ; sushi'), ['pizza', 'tacos', 'sushi']);
assert.deepEqual(parseChoices('pizza or tacos or sushi'), ['pizza', 'tacos', 'sushi']);
assert.deepEqual(parseChoices('red or blue, green'), ['red or blue', 'green'], 'commas win, so " or " inside an option is kept');
assert.deepEqual(parseChoices(' a ,, b , '), ['a', 'b'], 'empty options are dropped');
assert.deepEqual(parseChoices(''), []);
assert.equal(pickRandom(['a', 'b', 'c'], (min, max) => max - 1), 'c');
assert.throws(() => pickRandom([]), RangeError);
const many = pickMany(['a', 'b', 'c', 'd'], 3, () => 0);
assert.deepEqual(many, ['a', 'b', 'c']);
assert.equal(new Set(pickMany(['a', 'b', 'c', 'd', 'e'], 5)).size, 5, 'no option is picked twice');
assert.equal(pickMany(['a', 'b'], 9).length, 2, 'asking for more than there are returns them all');

// 8ball
assert.equal(EIGHT_BALL_ANSWERS.length, 20);
assert.equal(EIGHT_BALL_ANSWERS.filter((answer) => answer.tone === 'yes').length, 10);
assert.ok(EIGHT_BALL_ANSWERS.every((answer) => ['yes', 'maybe', 'no'].includes(answer.tone) && answer.text));

// ship
assert.equal(shipScore('111', '222'), shipScore('222', '111'), 'the order does not matter');
assert.equal(shipScore('111', '222'), shipScore('111', '222'), 'the same pair always gets the same score');
assert.equal(shipScore('123', '123'), 100);
for (let i = 0; i < 300; i += 1) {
  const score = shipScore(String(i), String(i * 7 + 1));
  assert.ok(Number.isInteger(score) && score >= 0 && score <= 100);
}
const spread = new Set(Array.from({ length: 300 }, (_, i) => shipScore(String(i), 'x')));
assert.ok(spread.size > 40, 'scores are spread out, not stuck on a few values');
assert.equal(shipBar(0), '▱▱▱▱▱▱▱▱▱▱');
assert.equal(shipBar(100), '▰▰▰▰▰▰▰▰▰▰');
assert.equal(shipBar(50), '▰▰▰▰▰▱▱▱▱▱');
for (const score of [0, 14, 15, 34, 35, 54, 55, 74, 75, 89, 90, 100]) assert.ok(shipVerdict(score).length > 0);
assert.equal(shipVerdict(100), 'Soulmates');
assert.equal(shipVerdict(0), 'Not meant to be');

// rock paper scissors
assert.equal(rpsOutcome('rock', 'scissors'), 'win');
assert.equal(rpsOutcome('rock', 'paper'), 'lose');
assert.equal(rpsOutcome('rock', 'rock'), 'tie');
for (const player of RPS_CHOICES) {
  for (const bot of RPS_CHOICES) {
    const forward = rpsOutcome(player, bot);
    const backward = rpsOutcome(bot, player);
    assert.equal(forward === 'win', backward === 'lose', `${player} vs ${bot} must mirror`);
    assert.equal(forward === 'tie', player === bot);
  }
}
assert.throws(() => rpsOutcome('lizard', 'rock'), RangeError);

console.log('Checked the fun command logic.');
