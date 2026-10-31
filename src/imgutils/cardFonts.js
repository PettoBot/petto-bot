// i18n-ignore-file: font family names are proper names, never translated
// The fonts image cards can use. The files are WOFF2 in src/assets/fonts, named `<slug>-<weight>.woff2`.
// The same list is in the dashboard, which loads the same files to draw the preview.
const path = require('node:path');
const fs = require('node:fs');
const { GlobalFonts } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

/** `tier` says who can pick it: every server gets the 15 free ones, Premium gets all 40. */
const CARD_FONTS = [
  { family: 'Poppins', slug: 'poppins', weights: [400, 700, 800], tier: 'free' },
  { family: 'Inter', slug: 'inter', weights: [400, 700, 800], tier: 'free' },
  { family: 'Montserrat', slug: 'montserrat', weights: [400, 700, 800], tier: 'free' },
  { family: 'Bebas Neue', slug: 'bebas-neue', weights: [400], tier: 'free' },
  { family: 'Oswald', slug: 'oswald', weights: [400, 700], tier: 'free' },
  { family: 'Playfair Display', slug: 'playfair-display', weights: [400, 700], tier: 'free' },
  { family: 'Roboto Mono', slug: 'roboto-mono', weights: [400, 700], tier: 'free' },
  { family: 'Fredoka', slug: 'fredoka', weights: [400, 700], tier: 'free' },
  { family: 'Caveat', slug: 'caveat', weights: [400, 700], tier: 'free' },
  { family: 'Anton', slug: 'anton', weights: [400], tier: 'free' },
  { family: 'Pacifico', slug: 'pacifico', weights: [400], tier: 'premium' },
  { family: 'Lobster', slug: 'lobster', weights: [400], tier: 'free' },
  { family: 'Righteous', slug: 'righteous', weights: [400], tier: 'free' },
  { family: 'Bangers', slug: 'bangers', weights: [400], tier: 'free' },
  { family: 'Permanent Marker', slug: 'permanent-marker', weights: [400], tier: 'premium' },
  { family: 'Press Start 2P', slug: 'press-start-2p', weights: [400], tier: 'premium' },
  { family: 'Nunito', slug: 'nunito', weights: [400, 700, 800], tier: 'free' },
  { family: 'Quicksand', slug: 'quicksand', weights: [400, 700], tier: 'free' },
  { family: 'Space Grotesk', slug: 'space-grotesk', weights: [400, 700], tier: 'premium' },
  { family: 'Orbitron', slug: 'orbitron', weights: [400, 700, 800], tier: 'premium' },
  { family: 'Dancing Script', slug: 'dancing-script', weights: [400, 700], tier: 'premium' },
  { family: 'Comfortaa', slug: 'comfortaa', weights: [400, 700], tier: 'premium' },
  { family: 'Rubik', slug: 'rubik', weights: [400, 700, 800], tier: 'premium' },
  { family: 'Russo One', slug: 'russo-one', weights: [400], tier: 'premium' },
  { family: 'Cinzel', slug: 'cinzel', weights: [400, 700, 800], tier: 'premium' },
  { family: 'Abril Fatface', slug: 'abril-fatface', weights: [400], tier: 'premium' },
  { family: 'Satisfy', slug: 'satisfy', weights: [400], tier: 'premium' },
  { family: 'Shadows Into Light', slug: 'shadows-into-light', weights: [400], tier: 'premium' },
  { family: 'VT323', slug: 'vt323', weights: [400], tier: 'premium' },
  { family: 'Audiowide', slug: 'audiowide', weights: [400], tier: 'premium' },
  { family: 'Baloo 2', slug: 'baloo-2', weights: [400, 700, 800], tier: 'premium' },
  { family: 'Bungee', slug: 'bungee', weights: [400], tier: 'premium' },
  { family: 'Chewy', slug: 'chewy', weights: [400], tier: 'premium' },
  { family: 'Creepster', slug: 'creepster', weights: [400], tier: 'premium' },
  { family: 'Special Elite', slug: 'special-elite', weights: [400], tier: 'premium' },
  { family: 'Great Vibes', slug: 'great-vibes', weights: [400], tier: 'premium' },
  { family: 'Kanit', slug: 'kanit', weights: [400, 700, 800], tier: 'premium' },
  { family: 'Archivo Black', slug: 'archivo-black', weights: [400], tier: 'premium' },
  { family: 'Lilita One', slug: 'lilita-one', weights: [400], tier: 'premium' },
  { family: 'Staatliches', slug: 'staatliches', weights: [400], tier: 'premium' },
];

// Fonts that are not offered in the editor: they only draw the letters the chosen font does not have (Arabic and Hebrew names).
const FALLBACK_FONTS = [
  { family: 'Noto Sans Arabic', slug: 'noto-sans-arabic', weights: [400, 700] },
  { family: 'Noto Sans Hebrew', slug: 'noto-sans-hebrew', weights: [400, 700] },
];
const DEFAULT_FONT = 'Poppins';
const byFamily = new Map(CARD_FONTS.map((font) => [font.family, font]));
let registered = false;
const EMOJI_FONT = 'Noto Color Emoji';
let emojiFont = null;

/** Registers every font file once. A missing file is skipped, the card then falls back to the default font. */
function registerCardFonts() {
  if (registered) return;
  registered = true;
  for (const font of CARD_FONTS) {
    for (const weight of font.weights) {
      const file = path.join(FONT_DIR, `${font.slug}-${weight}.woff2`);
      if (fs.existsSync(file)) GlobalFonts.registerFromPath(file, `${font.family} ${weight}`);
    }
  }
  for (const font of FALLBACK_FONTS) {
    for (const weight of font.weights) {
      const file = path.join(FONT_DIR, `${font.slug}-${weight}.woff2`);
      if (fs.existsSync(file)) GlobalFonts.registerFromPath(file, `${font.family} ${weight}`);
    }
  }
}

function fontExists(family) { return byFamily.has(family); }
function isPremiumFont(family) { return byFamily.get(family)?.tier === 'premium'; }

/** The closest weight the font really has. Asking for 800 on a font that has 400 only gives 400. */
function nearestWeight(family, weight) {
  const font = byFamily.get(family) ?? byFamily.get(DEFAULT_FONT);
  return font.weights.reduce((best, candidate) => (Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best), font.weights[0]);
}

/** The canvas font string for a family and weight, such as `700 40px "Poppins 700"`. */
function canvasFont(family, weight, size) {
  const font = byFamily.get(family) ?? byFamily.get(DEFAULT_FONT);
  const real = nearestWeight(font.family, weight);
  // The letters of Arabic and Hebrew and the emoji come after the family, so a name in them is drawn and not shown as empty boxes.
  const bold = real >= 600 ? 700 : 400;
  return `${size}px "${font.family} ${real}", "Noto Sans Arabic ${bold}", "Noto Sans Hebrew ${bold}", "${EMOJI_FONT}", sans-serif`;
}

/** True when the server has a color emoji font to draw emoji with. */
function emojiAvailable() {
  if (emojiFont === null) emojiFont = GlobalFonts.families.some((font) => font.family === EMOJI_FONT);
  return emojiFont;
}

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}\u200d\ufe0f\u20e3]/gu;
/** The text as the card can draw it: emoji are taken out when the machine has no emoji font, instead of showing empty boxes. */
function printable(text, hasEmojiFont = emojiAvailable()) {
  if (hasEmojiFont) return text;
  return text.replace(EMOJI, '').replace(/ {2,}/g, ' ').trim();
}

module.exports = { printable, emojiAvailable, CARD_FONTS, DEFAULT_FONT, registerCardFonts, fontExists, isPremiumFont, nearestWeight, canvasFont };
