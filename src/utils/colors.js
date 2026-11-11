// Petto's brand palette — every status/accent color in the bot should come from here
// rather than a one-off hex literal, so changing the palette is a one-file edit.
const COLORS = {
  GREEN: 0xa5ea7a, // success / approved / positive status
  YELLOW: 0xfed53c, // warning / caution / pending (the sanction cards only)
  RED: 0xfe6465, // error / denied / destructive
  DEFAULT: 0x4b4f59, // neutral / informational / default accent
};

// The status cards (a confirmation, a refusal, a warning, an answer) have NO color on their side: the icon at the start says it, and the card stays plain,
// like the ones of the best bots. `semanticColor` and `colorFromText` stay so every card keeps asking them, and they answer "no color". Only the sanction cards
// (`textCard(..., { keep: true })`) and the cards that carry the color of what they show (a feed of YouTube, a platform) keep their own.
/** Always null: a status card is drawn with no color. */
function semanticColor() {
  return null;
}

/** Always null: the icon that starts a text says what it is, it does not color the card. */
function colorFromText() {
  return null;
}

module.exports = { COLORS, semanticColor, colorFromText };
