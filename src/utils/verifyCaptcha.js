// The second verification method: a picture with letters that the member types. The picture is drawn with noise and a wave so a
// program cannot read it easily; nothing is stored: the answer travels signed in a ticket (an HMAC of the answer, tied to the
// verification link and to a nonce), and wrong answers are counted per link in memory.
const crypto = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const config = require('../config');
const { registerCardFonts, canvasFont } = require('../imgutils/cardFonts');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: they look alike
const LENGTH = 5;
const WIDTH = 260;
const HEIGHT = 96;
const TICKET_TTL_SECONDS = 5 * 60;
const MAX_WRONG = 5;
const WRONG_WINDOW_MS = 10 * 60_000;
const COLORS = ['#ff9ecb', '#7fd1ff', '#ffd27f', '#a8f08a', '#c4a1ff', '#ff8a80'];

const wrong = new Map(); // jti -> { count, until }

const b64 = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mac = (secret, input) => crypto.createHmac('sha256', secret).update(input).digest();
const pick = (list) => list[crypto.randomInt(list.length)];
const between = (min, max) => min + crypto.randomInt(Math.round((max - min) * 1000) + 1) / 1000;

/** The letters of a new picture. */
function randomText() {
  return Array.from({ length: LENGTH }, () => pick([...ALPHABET])).join('');
}

/** A PNG with `text` drawn crooked, in colors, with lines and dots over it, and a wave through the whole picture. */
function drawPicture(text) {
  registerCardFonts();
  const plain = createCanvas(WIDTH, HEIGHT);
  const ctx = plain.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#1c1d22');
  gradient.addColorStop(1, '#2a2c34');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (let i = 0; i < 7; i += 1) {
    ctx.strokeStyle = `${pick(COLORS)}66`;
    ctx.lineWidth = between(1, 2.6);
    ctx.beginPath();
    ctx.moveTo(between(0, WIDTH), between(0, HEIGHT));
    ctx.bezierCurveTo(between(0, WIDTH), between(0, HEIGHT), between(0, WIDTH), between(0, HEIGHT), between(0, WIDTH), between(0, HEIGHT));
    ctx.stroke();
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const step = (WIDTH - 40) / text.length;
  [...text].forEach((letter, index) => {
    ctx.save();
    ctx.translate(30 + step * index + step / 2 + between(-3, 3), HEIGHT / 2 + between(-9, 9));
    ctx.rotate(between(-0.4, 0.4));
    ctx.font = canvasFont('Poppins', 700, Math.round(between(46, 58)));
    ctx.fillStyle = pick(COLORS);
    ctx.fillText(letter, 0, 0);
    ctx.restore();
  });
  for (let i = 0; i < 90; i += 1) {
    ctx.fillStyle = `${pick(COLORS)}99`;
    ctx.fillRect(between(0, WIDTH), between(0, HEIGHT), between(1, 2.4), between(1, 2.4));
  }
  // The wave: every column of the picture is moved up or down a little.
  const wavy = createCanvas(WIDTH, HEIGHT);
  const out = wavy.getContext('2d');
  const phase = between(0, 6.28);
  const period = between(14, 22);
  for (let x = 0; x < WIDTH; x += 1) out.drawImage(plain, x, 0, 1, HEIGHT, x, Math.sin(x / period + phase) * 4, 1, HEIGHT);
  return wavy.toBuffer('image/png');
}

/** A new challenge for a verification link: the PNG and the signed ticket the page sends back with the answer. */
function createChallenge(jti, { text = randomText(), now = Date.now() } = {}) {
  const nonce = b64(crypto.randomBytes(8));
  const payload = b64(Buffer.from(JSON.stringify({ j: jti, n: nonce, a: b64(mac(config.verifyTokenSecret, `${jti}:${nonce}:${text}`)), e: Math.floor(now / 1000) + TICKET_TTL_SECONDS })));
  return { png: drawPicture(text), ticket: `${payload}.${b64(mac(config.verifyTokenSecret, payload))}`, text };
}

const normalize = (answer) => String(answer ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/** `{ ok: true }`, or `{ ok: false, reason }` with `expired`, `invalid`, `wrong` or `locked`. */
function checkAnswer(jti, ticket, answer, { now = Date.now() } = {}) {
  const lock = wrong.get(jti);
  if (lock && lock.until > now && lock.count >= MAX_WRONG) return { ok: false, reason: 'locked' };
  const [payload, signature] = String(ticket ?? '').split('.');
  if (!payload || !signature) return { ok: false, reason: 'invalid' };
  const expected = b64(mac(config.verifyTokenSecret, payload));
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return { ok: false, reason: 'invalid' };
  let data;
  try { data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return { ok: false, reason: 'invalid' }; }
  if (data.j !== jti) return { ok: false, reason: 'invalid' };
  if (Math.floor(now / 1000) > data.e) return { ok: false, reason: 'expired' };
  const given = b64(mac(config.verifyTokenSecret, `${jti}:${data.n}:${normalize(answer)}`));
  if (given.length === data.a.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(data.a))) {
    wrong.delete(jti);
    return { ok: true };
  }
  const count = (lock && lock.until > now ? lock.count : 0) + 1;
  wrong.set(jti, { count, until: now + WRONG_WINDOW_MS });
  if (wrong.size > 5_000) wrong.delete(wrong.keys().next().value);
  return { ok: false, reason: count >= MAX_WRONG ? 'locked' : 'wrong' };
}

function clearAttempts() { wrong.clear(); }

module.exports = { createChallenge, checkAnswer, randomText, clearAttempts, ALPHABET, LENGTH, MAX_WRONG, TICKET_TTL_SECONDS };
