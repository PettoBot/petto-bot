// Petto's brand palette — every status/accent color in the bot should come from here
// rather than a one-off hex literal, so changing the palette is a one-file edit.
const COLORS = {
  GREEN: 0xa5ea7a, // success / approved / positive status
  YELLOW: 0xfed53c, // warning / caution / pending
  RED: 0xfe6465, // error / denied / destructive
  BLUE: 0x8399ff, // neutral / informational / default accent
};

module.exports = { COLORS };
