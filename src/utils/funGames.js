// Logic behind the small fun commands (8ball, ship, rps, choose). Free of Discord so scripts/check-fun.js can test it.
const { createHash, randomInt } = require('node:crypto');
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

function shipVerdict(score, lang = currentLanguage()) {
  if (score >= 90) return t(lang, 'fun.ship.verdict.soulmates');
  if (score >= 75) return t(lang, 'fun.ship.verdict.greatMatch');
  if (score >= 55) return t(lang, 'fun.ship.verdict.goodChemistry');
  if (score >= 35) return t(lang, 'fun.ship.verdict.withEffort');
  if (score >= 15) return t(lang, 'fun.ship.verdict.justFriends');
  return t(lang, 'fun.ship.verdict.notMeant');
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
  shipVerdict,
  shipBar,
  rpsOutcome,
};
