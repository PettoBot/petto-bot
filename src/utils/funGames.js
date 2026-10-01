// Logic behind the small fun commands (8ball, ship, rps, choose). Free of Discord so scripts/check-fun.js can test it.
const { createHash, randomInt } = require('node:crypto');

const EIGHT_BALL_ANSWERS = [
  { tone: 'yes', text: 'It is certain.' },
  { tone: 'yes', text: 'Without a doubt.' },
  { tone: 'yes', text: 'Yes, definitely.' },
  { tone: 'yes', text: 'You may rely on it.' },
  { tone: 'yes', text: 'As I see it, yes.' },
  { tone: 'yes', text: 'Most likely.' },
  { tone: 'yes', text: 'Outlook good.' },
  { tone: 'yes', text: 'Yes.' },
  { tone: 'yes', text: 'Signs point to yes.' },
  { tone: 'yes', text: 'All the stars agree.' },
  { tone: 'maybe', text: 'Reply hazy, try again.' },
  { tone: 'maybe', text: 'Ask again later.' },
  { tone: 'maybe', text: 'Better not tell you now.' },
  { tone: 'maybe', text: 'Cannot predict now.' },
  { tone: 'maybe', text: 'Concentrate and ask again.' },
  { tone: 'no', text: 'Do not count on it.' },
  { tone: 'no', text: 'My reply is no.' },
  { tone: 'no', text: 'My sources say no.' },
  { tone: 'no', text: 'Outlook not so good.' },
  { tone: 'no', text: 'Very doubtful.' },
];

const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const RPS_ICON = { rock: '✊', paper: '✋', scissors: '✌️' };

/** Picks one entry. `random(min, maxExclusive)` can be replaced in tests. */
function pickRandom(list, random = randomInt) {
  if (!list.length) throw new RangeError('Nothing to pick from.');
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

function shipVerdict(score) {
  if (score >= 90) return 'Soulmates';
  if (score >= 75) return 'A great match';
  if (score >= 55) return 'Good chemistry';
  if (score >= 35) return 'Could work with effort';
  if (score >= 15) return 'Just friends, maybe';
  return 'Not meant to be';
}

function shipBar(score, segments = 10) {
  const filled = Math.round((score / 100) * segments);
  return `${'▰'.repeat(filled)}${'▱'.repeat(segments - filled)}`;
}

/** The result of a rock, paper, scissors round from the player's point of view. */
function rpsOutcome(player, bot) {
  if (!RPS_BEATS[player] || !RPS_BEATS[bot]) throw new RangeError('Unknown rock paper scissors choice.');
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
  shipVerdict,
  shipBar,
  rpsOutcome,
};
