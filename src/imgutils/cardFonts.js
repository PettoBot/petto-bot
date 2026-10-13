// The fonts image cards can use. The files are WOFF2 in src/assets/fonts, named `<slug>-<weight>.woff2`.
// The same list is in the dashboard, which loads the same files to draw the preview.
const path = require('node:path');
const fs = require('node:fs');
const { GlobalFonts } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

/** `tier` says who can pick it: free servers get a short list, Premium gets all of them. */
const CARD_FONTS = [
  { family: 'Poppins', slug: 'poppins', weights: [400, 700, 800], tier: 'free' },
  { family: 'Inter', slug: 'inter', weights: [400, 700, 800], tier: 'free' },
  { family: 'Montserrat', slug: 'montserrat', weights: [400, 700, 800], tier: 'free' },
  { family: 'Bebas Neue', slug: 'bebas-neue', weights: [400], tier: 'free' },
  { family: 'Oswald', slug: 'oswald', weights: [400, 700], tier: 'premium' },
  { family: 'Playfair Display', slug: 'playfair-display', weights: [400, 700], tier: 'premium' },
  { family: 'Roboto Mono', slug: 'roboto-mono', weights: [400, 700], tier: 'premium' },
  { family: 'Fredoka', slug: 'fredoka', weights: [400, 700], tier: 'premium' },
  { family: 'Caveat', slug: 'caveat', weights: [400, 700], tier: 'premium' },
  { family: 'Anton', slug: 'anton', weights: [400], tier: 'premium' },
  { family: 'Pacifico', slug: 'pacifico', weights: [400], tier: 'premium' },
  { family: 'Lobster', slug: 'lobster', weights: [400], tier: 'premium' },
  { family: 'Righteous', slug: 'righteous', weights: [400], tier: 'premium' },
  { family: 'Bangers', slug: 'bangers', weights: [400], tier: 'premium' },
  { family: 'Permanent Marker', slug: 'permanent-marker', weights: [400], tier: 'premium' },
  { family: 'Press Start 2P', slug: 'press-start-2p', weights: [400], tier: 'premium' },
  { family: 'Nunito', slug: 'nunito', weights: [400, 700, 800], tier: 'free' },
  { family: 'Quicksand', slug: 'quicksand', weights: [400, 700], tier: 'premium' },
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

const DEFAULT_FONT = 'Poppins';
const byFamily = new Map(CARD_FONTS.map((font) => [font.family, font]));
let registered = false;

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
  return `${size}px "${font.family} ${real}"`;
}

module.exports = { CARD_FONTS, DEFAULT_FONT, registerCardFonts, fontExists, isPremiumFont, nearestWeight, canvasFont };
