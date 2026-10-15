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
const { readRpsChoice } = require('../src/utils/funGames');
for (const [typed, move] of [['rock', 'rock'], ['Piedra', 'rock'], ['pedra', 'rock'], ['papel', 'paper'], ['tijera', 'scissors'], ['TESOURA', 'scissors'], ['lizard', null]]) {
  assert.equal(readRpsChoice(typed), move, `!rps ${typed}`);
}

// The fun commands answer with plain text; /ship adds the picture. A card is a PNG even when the avatars cannot load.
(async () => {
  const { buildShipCard } = require('../src/imgutils/shipCard');
  const card = await buildShipCard({ avatarA: '/missing-a.png', avatarB: '/missing-b.png', nameA: 'A', nameB: 'B'.repeat(80), score: 42 });
  assert.deepEqual([...card.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'the ship card is a PNG');

  const replies = [];
  const interaction = {
    options: { getString: () => 'Will it work?\n\nreally', getUser: () => ({ id: '1', username: 'a', displayAvatarURL: () => '/missing.png' }) },
    user: { id: '2', username: 'b', displayAvatarURL: () => '/missing.png' },
    member: { displayName: 'B' },
    guild: null,
    deferReply: async () => {},
    reply: async (payload) => replies.push(payload),
    editReply: async (payload) => replies.push(payload),
  };
  for (const name of ['8ball', 'rps', 'ship']) {
    replies.length = 0;
    const command = require(`../src/commands/fun/${name}`);
    await command.execute({ ...interaction, options: { getString: () => (name === 'rps' ? 'rock' : 'Will it work?\n\nreally'), getUser: interaction.options.getUser } });
    const [payload] = replies;
    assert.ok(typeof payload.content === 'string' && payload.content.length > 0, `${name} answers with plain text`);
    assert.ok(!payload.flags && !payload.components && !payload.embeds, `${name} is not an embed or a container`);
  }
  assert.ok(replies[0].files?.length === 1 && replies[0].files[0].name === 'ship.png', '/ship attaches its picture');

  // In Spanish and Portuguese: the answers, the moves and the verdicts are translated; the typed moves stay English.
  const { t } = require('../src/i18n');
  assert.equal(shipVerdict(100, 'es'), 'Almas gemelas');
  assert.equal(shipVerdict(0, 'pt-BR'), 'Não nasceram um para o outro');
  const run = async (name, lang, value) => {
    replies.length = 0;
    await require(`../src/commands/fun/${name}`).execute({ ...interaction, pettoLang: lang, options: { getString: () => value, getUser: interaction.options.getUser } });
    return replies[0].content;
  };
  const eightBall = await run('8ball', 'es', 'Will it work?');
  assert.ok(EIGHT_BALL_ANSWERS.some((answer) => eightBall.startsWith(`🎱 **${t('es', answer.key)}**`)), '8ball answers in Spanish');
  assert.match(await run('rps', 'pt-BR', 'rock'), /^✊ \*\*pedra\*\* {2}vs {2}.+\n\*\*(Você ganhou!|Eu ganhei!|Deu empate\.)\*\*$/);
  assert.equal(await run('rps', 'es', 'lagarto'), t('es', 'fun.rps.pick'));
  assert.match(await run('rps', 'es', 'piedra'), /^✊ \*\*piedra\*\* {2}vs /, 'the Spanish word is a move');
  assert.match(await run('rps', 'pt-BR', 'tesoura'), /^✌️ \*\*tesoura\*\* {2}vs /, 'the Portuguese word is a move');
  assert.equal(await run('ship', 'es', ''), '💞 **a** × **a**: **100%** · Almas gemelas', 'a member with themselves, in Spanish');

  console.log('Checked the fun command logic.');
})().catch((err) => { console.error(err); process.exit(1); });
