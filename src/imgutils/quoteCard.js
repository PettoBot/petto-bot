// i18n-ignore-file: draws a picture; the only words on it are the quoted message and the names of its author
// Draws the picture of !quote: the avatar of the author on the left, in black and white, fading into a black background, and the
// words of the message on the right in a large serif font, with the name and "@username" under them.
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont } = require('./cardFonts');

const W = 1200;
const H = 630;
const AVATAR = H; // the avatar fills the height of the picture
const TEXT_LEFT = 610;
const TEXT_RIGHT = W - 70;
const TEXT_WIDTH = TEXT_RIGHT - TEXT_LEFT;
const TEXT_CENTER = (TEXT_LEFT + TEXT_RIGHT) / 2;
const TOP = 70;
const BOTTOM = H - 70;
const AUTHOR_BLOCK = 96; // the space the name and the username take under the words
const GAP = 34; // between the words and the name
const SIZES = { max: 88, min: 26 };
const QUOTE_FONT = 'Playfair Display';
const NAME_FONT = 'Montserrat';

const THEMES = {
  dark: { background: '#000000', text: '#f5f5f5', name: '#e6e6e6', username: 'rgba(255, 255, 255, 0.5)', fade: [0, 0, 0], rule: 'rgba(255, 255, 255, 0.22)' },
  light: { background: '#ffffff', text: '#141414', name: '#1c1c1c', username: 'rgba(0, 0, 0, 0.5)', fade: [255, 255, 255], rule: 'rgba(0, 0, 0, 0.18)' },
};

/**
 * The words and emojis of the pieces, as tokens laid out one after another: words, spaces, emojis and line breaks. An emoji
 * whose image could not be had is written as text instead (its `:name:`, or the character itself).
 */
function tokensOf(pieces, emojis = new Map()) {
  const tokens = [];
  for (const raw of pieces) {
    if (raw.type === 'emoji' && emojis.has(raw.key)) { tokens.push({ kind: 'emoji', piece: raw }); continue; }
    const text = raw.type === 'emoji' ? raw.fallback : raw.text;
    const parts = text.split(/(\n| )/);
    for (const part of parts) {
      if (part === '\n') tokens.push({ kind: 'break' });
      else if (part === ' ') tokens.push({ kind: 'space' });
      else if (part) tokens.push({ kind: 'word', text: part });
    }
  }
  return tokens;
}

/** Splits a word too wide for a line into parts that fit. */
function splitWord(ctx, word, width) {
  const parts = [];
  let current = '';
  for (const char of word) {
    if (current && ctx.measureText(current + char).width > width) { parts.push(current); current = char; } else current += char;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Lays the tokens out in lines no wider than `width` with the font size `size`. Each line is a list of runs (text or emoji)
 * with their widths. Emojis are as wide as the font is high.
 */
function layout(ctx, tokens, size, width) {
  const emojiSize = Math.round(size * 1.05);
  const lines = [];
  let line = [];
  let lineWidth = 0;
  let pendingSpace = 0;
  const spaceWidth = ctx.measureText(' ').width;
  const finish = () => {
    lines.push({ runs: line, width: lineWidth });
    line = [];
    lineWidth = 0;
    pendingSpace = 0;
  };
  const place = (run) => {
    if (line.length && lineWidth + pendingSpace + run.width > width) finish();
    if (line.length) { run.gap = pendingSpace; lineWidth += pendingSpace; } else run.gap = 0;
    line.push(run);
    lineWidth += run.width;
    pendingSpace = 0;
  };
  for (const token of tokens) {
    if (token.kind === 'break') { finish(); continue; }
    if (token.kind === 'space') { if (line.length) pendingSpace = spaceWidth; continue; }
    if (token.kind === 'emoji') { place({ kind: 'emoji', piece: token.piece, width: emojiSize + size * 0.14 }); continue; }
    const measured = ctx.measureText(token.text).width;
    if (measured <= width) { place({ kind: 'text', text: token.text, width: measured }); continue; }
    for (const part of splitWord(ctx, token.text, width)) place({ kind: 'text', text: part, width: ctx.measureText(part).width });
  }
  if (line.length || !lines.length) finish();
  // Line breaks at the start or end say nothing.
  while (lines.length > 1 && !lines[0].runs.length) lines.shift();
  while (lines.length > 1 && !lines[lines.length - 1].runs.length) lines.pop();
  return { lines, emojiSize };
}

/** Cuts the last line so that it ends in "…" and fits the width. */
function ellipsize(ctx, line, width) {
  const dots = ctx.measureText('…').width;
  while (line.runs.length && line.width + dots > width) {
    const last = line.runs[line.runs.length - 1];
    if (last.kind === 'text' && last.text.length > 1) {
      const shorter = [...last.text].slice(0, -1).join('');
      const newWidth = ctx.measureText(shorter).width;
      line.width -= last.width - newWidth;
      last.text = shorter;
      last.width = newWidth;
    } else {
      line.width -= last.width + last.gap;
      line.runs.pop();
    }
  }
  const last = line.runs[line.runs.length - 1];
  if (last?.kind === 'text') { last.text = `${last.text.replace(/[\s.,;:]+$/, '')}…`; } else line.runs.push({ kind: 'text', text: '…', width: dots, gap: 0 });
  line.width = line.runs.reduce((sum, run) => sum + run.width + run.gap, 0);
}

/** The same number of lines at the narrowest width that keeps it, so a short quote does not leave one word alone on its last line. */
function balance(ctx, tokens, size, lines) {
  if (lines.length < 2 || lines.length > 6) return lines;
  let best = lines;
  for (let width = TEXT_WIDTH - 20; width >= TEXT_WIDTH * 0.5; width -= 20) {
    const narrower = layout(ctx, tokens, size, width).lines;
    if (narrower.length !== lines.length) break;
    best = narrower;
  }
  return best;
}

/** The largest font size whose lines fit the space; at the smallest size, the lines that fit, the last one ending in "…". */
function fitText(ctx, tokens, weight, maxHeight) {
  for (let size = SIZES.max; size >= SIZES.min; size -= 2) {
    ctx.font = canvasFont(QUOTE_FONT, weight, size);
    const lineHeight = Math.round(size * 1.28);
    const { lines, emojiSize } = layout(ctx, tokens, size, TEXT_WIDTH);
    if (lines.length * lineHeight <= maxHeight) return { size, lineHeight, lines: balance(ctx, tokens, size, lines), emojiSize };
  }
  const size = SIZES.min;
  ctx.font = canvasFont(QUOTE_FONT, weight, size);
  const lineHeight = Math.round(size * 1.28);
  const { lines, emojiSize } = layout(ctx, tokens, size, TEXT_WIDTH);
  const keep = Math.max(1, Math.floor(maxHeight / lineHeight));
  const kept = lines.slice(0, keep);
  ellipsize(ctx, kept[kept.length - 1], TEXT_WIDTH);
  return { size, lineHeight, lines: kept, emojiSize, truncated: true };
}

/** Cuts a single-line text to a width, ending it in "…". */
function clipLine(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let chars = [...text];
  while (chars.length > 1 && ctx.measureText(`${chars.join('')}…`).width > width) chars = chars.slice(0, -1);
  return `${chars.join('').trimEnd()}…`;
}

/** Draws the avatar on the left, in black and white unless `color`, fading into the background towards the words. */
function drawAvatar(ctx, avatar, theme, color) {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, W, H);
  const [r, g, b] = theme.fade;
  if (avatar) {
    const side = Math.min(avatar.width, avatar.height);
    ctx.save();
    ctx.filter = color ? 'contrast(1.04)' : 'grayscale(1) contrast(1.12) brightness(0.97)';
    ctx.drawImage(avatar, (avatar.width - side) / 2, (avatar.height - side) / 2, side, side, 0, 0, AVATAR, AVATAR);
    ctx.restore();
  } else {
    // No avatar could be had: a soft gray circle stands in for it.
    const shade = theme === THEMES.light ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)';
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(AVATAR * 0.42, H / 2, AVATAR * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // The avatar melts into the background: a long, eased fade to the right...
  const fade = ctx.createLinearGradient(0, 0, AVATAR, 0);
  const steps = [[0, 0], [0.3, 0.04], [0.5, 0.2], [0.65, 0.45], [0.8, 0.78], [0.92, 0.95], [1, 1]];
  for (const [at, alpha] of steps) fade.addColorStop(at, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, AVATAR + 1, H);
  // ...and a lighter one at the top and bottom edges, so the picture has no hard corners.
  const edges = ctx.createLinearGradient(0, 0, 0, H);
  edges.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.35)`);
  edges.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, 0)`);
  edges.addColorStop(0.82, `rgba(${r}, ${g}, ${b}, 0)`);
  edges.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.45)`);
  ctx.fillStyle = edges;
  ctx.fillRect(0, 0, AVATAR, H);
}

/** Draws one line of runs centered on the text column, with its baseline at `y`. */
function drawLine(ctx, line, y, size, emojiSize, emojis, theme) {
  let x = TEXT_CENTER - line.width / 2;
  for (const run of line.runs) {
    x += run.gap;
    if (run.kind === 'text') {
      ctx.fillStyle = theme.text;
      ctx.fillText(run.text, x, y);
    } else {
      const image = emojis.get(run.piece.key);
      if (image) ctx.drawImage(image, x + size * 0.07, y - size * 0.8 + (size - emojiSize) * 0.15, emojiSize, emojiSize);
    }
    x += run.width;
  }
}

/**
 * The quote picture as a PNG. `pieces` come from quotePieces(); `emojis` maps an emoji key to its image; `avatar` is an image or
 * null. `light` draws on white, `color` keeps the avatar in color and `bold` writes the words heavier.
 */
async function renderQuote({ pieces, emojis = new Map(), avatar = null, displayName = '', username = '', light = false, color = false, bold = false }) {
  registerCardFonts();
  const theme = light ? THEMES.light : THEMES.dark;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawAvatar(ctx, avatar, theme, color);

  // A whisper of light behind the words keeps the black from looking flat.
  if (!light) {
    const glow = ctx.createRadialGradient(TEXT_CENTER, H / 2, 10, TEXT_CENTER, H / 2, TEXT_WIDTH * 0.85);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.045)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(AVATAR * 0.6, 0, W - AVATAR * 0.6, H);
  }

  const weight = bold ? 700 : 400;
  const tokens = tokensOf(pieces, emojis);
  const maxHeight = BOTTOM - TOP - AUTHOR_BLOCK - GAP;
  const fit = fitText(ctx, tokens, weight, maxHeight);
  const textHeight = fit.lines.length * fit.lineHeight;
  const blockHeight = textHeight + GAP + AUTHOR_BLOCK;
  const blockTop = TOP + Math.max(0, (BOTTOM - TOP - blockHeight) / 2);

  ctx.font = canvasFont(QUOTE_FONT, weight, fit.size);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  fit.lines.forEach((line, index) => {
    const baseline = blockTop + index * fit.lineHeight + fit.lineHeight * 0.5 + fit.size * 0.36;
    drawLine(ctx, line, baseline, fit.size, fit.emojiSize, emojis, theme);
  });

  // A short rule, then the name and "@username", smaller and dimmer.
  const authorTop = blockTop + textHeight + GAP;
  ctx.fillStyle = theme.rule;
  ctx.fillRect(TEXT_CENTER - 28, authorTop, 56, 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.name;
  ctx.font = canvasFont(NAME_FONT, 700, 30);
  ctx.fillText(clipLine(ctx, displayName || username, TEXT_WIDTH), TEXT_CENTER, authorTop + 46);
  if (username) {
    ctx.fillStyle = theme.username;
    ctx.font = canvasFont(NAME_FONT, 400, 22);
    ctx.fillText(clipLine(ctx, `@${username}`, TEXT_WIDTH), TEXT_CENTER, authorTop + 80);
  }

  return canvas.encode('png');
}

module.exports = { renderQuote, QUOTE_SIZE: { width: W, height: H }, layout, tokensOf };
