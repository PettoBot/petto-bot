// Petto's brand palette — every status/accent color in the bot should come from here
// rather than a one-off hex literal, so changing the palette is a one-file edit.
const COLORS = {
  GREEN: 0xa5ea7a, // success / approved / positive status
  YELLOW: 0xfed53c, // warning / caution / pending (the sanction cards only)
  RED: 0xfe6465, // error / denied / destructive
  DEFAULT: 0x4b4f59, // neutral / informational / default accent
};

// A card has no color on its side, except to say something went well (green), was refused or needs attention (red), and the sanction
// cards, which keep their own colors. `semanticColor` lets only those two through, so a card that is given any other color is drawn
// with none.
const GREENS = new Set([COLORS.GREEN]);
const REDS = new Set([COLORS.RED, 0xff6b6b, 0xff2d2d]);

/** The color if it is a green or a red of the palette, or null: the card then has no color. */
function semanticColor(color) {
  return Number.isInteger(color) && (GREENS.has(color) || REDS.has(color)) ? color : null;
}

// A confirmation or a refusal starts with its icon: a card whose text starts with the "approved" icon is green, and one that starts with the
// "denied", "alert" or "warning" icon is red. This lets every message of that kind have its color without each place choosing it.
function startsWithIcon(text, icons) {
  const start = String(text ?? '').trimStart();
  return icons.some((icon) => icon && start.startsWith(icon));
}

/** The color a card of this text should have: green, red or null (the text does not start with such an icon). */
function colorFromText(text) {
  const { EMOJI } = require('./emojis');
  if (startsWithIcon(text, [EMOJI.APPROVE, EMOJI.RELEASE_APPROVED])) return COLORS.GREEN;
  if (startsWithIcon(text, [EMOJI.DENY, EMOJI.RELEASE_DENIED, EMOJI.ALERT, EMOJI.WARNING, EMOJI.RELEASE_ALERT])) return COLORS.RED;
  return null;
}

module.exports = { COLORS, semanticColor, colorFromText };
