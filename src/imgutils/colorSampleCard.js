// i18n-ignore-file: the picture has no sentence in it: color codes, contrast ratios, the grades AA and AAA and the name of the bot
// The picture of `!color`: the color as a big block, and how it behaves around other things. Beside the block, white and black text on it with their WCAG contrast,
// the color as text and as a button on a dark and on a light background, seven shades from darker to lighter, and a gradient to its complement.
// It knows nothing about Discord: the command gives it the color and sends the PNG.
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont } = require('./cardFonts');
const { hexOf, toHsl, contrastRatio, gradeOf, bestText, shades, complement } = require('../utils/colorParse');

const WIDTH = 1000;
const HEIGHT = 560;
const BACKGROUND = '#1b1c21';
const DARK_PANEL = '#26282e';
const LIGHT_PANEL = '#f5f6f8';
const FAMILY = 'Poppins';

const rgbText = (rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
const ink = (name) => (name === 'white' ? '#ffffff' : '#101114');
const inkRgb = (name) => (name === 'white' ? [255, 255, 255] : [16, 17, 20]);

function round(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRound(ctx, x, y, w, h, r, fill) {
  round(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** The ratio and the grade it earns, as a small pill with its right edge at `right` and its middle at `cy`. */
function badge(ctx, right, cy, ratio, background) {
  const grade = gradeOf(ratio);
  const label = `${ratio.toFixed(2)}`;
  ctx.font = canvasFont(FAMILY, 700, 16);
  const textWidth = ctx.measureText(label).width;
  const height = 28;
  const markWidth = grade === 'fail' ? 22 : ctx.measureText(grade === 'large' ? 'A' : grade).width;
  const width = textWidth + markWidth + 34;
  const x = right - width;
  fillRound(ctx, x, cy - height / 2, width, height, 14, 'rgba(10, 11, 14, 0.78)');
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 12, cy + 1);
  const mark = grade === 'fail' ? '#ff7a7a' : grade === 'large' ? '#f5c26b' : '#6fe0a0';
  const markX = x + 12 + textWidth + 10;
  if (grade === 'fail') {
    ctx.strokeStyle = mark; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(markX + 3, cy - 5); ctx.lineTo(markX + 13, cy + 5); ctx.moveTo(markX + 13, cy - 5); ctx.lineTo(markX + 3, cy + 5); ctx.stroke();
  } else {
    ctx.fillStyle = mark;
    ctx.fillText(grade === 'large' ? 'A' : grade, markX, cy + 1);
  }
  void background;
}

/** A chip of the color with text on it: "Aa" and the ratio. */
function textChip(ctx, x, y, w, h, rgb, textName) {
  fillRound(ctx, x, y, w, h, 20, rgbText(rgb));
  const color = ink(textName);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = canvasFont(FAMILY, 800, 44);
  ctx.fillText('Aa', x + 22, y + h / 2 + 2);
  ctx.font = canvasFont(FAMILY, 400, 20);
  ctx.fillText('Petto', x + 100, y + h / 2 + 4);
  badge(ctx, x + w - 14, y + h - 22, contrastRatio(rgb, inkRgb(textName)), rgb);
}

/** The color as text and as a button, on a panel of the given background. */
function sampleOnPanel(ctx, x, y, w, h, rgb, panel) {
  fillRound(ctx, x, y, w, h, 20, panel);
  const panelRgb = panel === LIGHT_PANEL ? [245, 246, 248] : [38, 40, 46];
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = rgbText(rgb);
  ctx.font = canvasFont(FAMILY, 800, 40);
  ctx.fillText('Petto', x + 22, y + 46);
  ctx.font = canvasFont(FAMILY, 400, 18);
  ctx.fillText('Aa Bb Cc 123', x + 22, y + 88);
  const textName = bestText(rgb);
  fillRound(ctx, x + 22, y + h - 66, 108, 44, 22, rgbText(rgb));
  ctx.fillStyle = ink(textName);
  ctx.font = canvasFont(FAMILY, 700, 18);
  ctx.textAlign = 'center';
  ctx.fillText('Petto', x + 22 + 54, y + h - 43);
  // How readable the color is against this panel.
  badge(ctx, x + w - 14, y + h - 43, contrastRatio(rgb, panelRgb), panelRgb);
}

/**
 * Draws the sample picture of a color.
 * @param {{rgb: [number, number, number]}} options
 * @returns {Buffer} a PNG of 1000x560
 */
function renderColorSample({ rgb }) {
  registerCardFonts();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // The big block, with the codes on it in the text that reads best.
  const textName = bestText(rgb);
  const [h, s, l] = toHsl(...rgb);
  fillRound(ctx, 28, 28, 340, 504, 30, rgbText(rgb));
  ctx.fillStyle = ink(textName);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = canvasFont(FAMILY, 800, 46);
  ctx.fillText(hexOf(...rgb).toUpperCase(), 54, 452);
  ctx.globalAlpha = 0.82;
  ctx.font = canvasFont(FAMILY, 400, 20);
  ctx.fillText(rgbText(rgb), 54, 484);
  ctx.globalAlpha = 0.82;
  ctx.font = canvasFont(FAMILY, 400, 20);
  ctx.fillText(`hsl(${h}, ${s}%, ${l}%)`, 54, 512);
  ctx.globalAlpha = 1;

  const left = 396;
  const gap = 16;
  const half = (972 - left - gap) / 2;
  // White and black text on the color.
  textChip(ctx, left, 28, half, 100, rgb, 'white');
  textChip(ctx, left + half + gap, 28, half, 100, rgb, 'black');
  // The color on a dark and on a light background.
  sampleOnPanel(ctx, left, 144, half, 196, rgb, DARK_PANEL);
  sampleOnPanel(ctx, left + half + gap, 144, half, 196, rgb, LIGHT_PANEL);

  // Seven shades, darker to lighter.
  const steps = shades(rgb, 7);
  const cell = (972 - left - gap * 6) / 7;
  steps.forEach((shade, i) => {
    const x = left + i * (cell + gap);
    fillRound(ctx, x, 356, cell, 70, 16, rgbText(shade));
    if (i === 3) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; ctx.lineWidth = 3;
      round(ctx, x + 1.5, 356 + 1.5, cell - 3, 70 - 3, 15); ctx.stroke();
    }
    ctx.fillStyle = '#9aa0ad';
    ctx.font = canvasFont(FAMILY, 400, 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(hexOf(...shade), x + cell / 2, 446);
  });

  // The way to its complement.
  const opposite = complement(rgb);
  const gradient = ctx.createLinearGradient(left, 0, 972, 0);
  gradient.addColorStop(0, rgbText(rgb));
  gradient.addColorStop(1, rgbText(opposite));
  fillRound(ctx, left, 466, 972 - left, 66, 20, gradient);
  const dotTextA = ink(bestText(rgb));
  const dotTextB = ink(bestText(opposite));
  ctx.font = canvasFont(FAMILY, 700, 18);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = dotTextA;
  ctx.fillText(hexOf(...rgb).toUpperCase(), left + 22, 500);
  ctx.textAlign = 'right';
  ctx.fillStyle = dotTextB;
  ctx.fillText(hexOf(...opposite).toUpperCase(), 972 - 22, 500);

  return canvas.toBuffer('image/png');
}

module.exports = { renderColorSample, WIDTH, HEIGHT };
