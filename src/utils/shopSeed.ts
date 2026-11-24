// i18n-ignore-file: the names of the fonts are proper names, never translated.
// The name fonts the shop of the profile starts with: the ones of the name customization of Vetox (the same families, free Google fonts), by the three levels of rarity they
// have there. The bot saves them into the shop the first time it starts (`shop_items`), and from then on the editor of the team owns them: renaming one, changing its price
// or taking it off sale is never undone by a restart.
// Written in TypeScript: `npm run build:ts` compiles it over utils/shopSeed.js.
const fs = require('node:fs/promises') as typeof import('node:fs/promises');
const path = require('node:path') as typeof import('node:path');
const shopDb = require('../db/shop') as typeof import('../db/shop');
const shopRules = require('./shopRules') as typeof import('./shopRules');

type Rarity = 'rare' | 'epic' | 'legendary';
/** `slug` is the file in src/assets/fonts (`<slug>-400.woff2`) and the id in the shop. */
export const FONTS: readonly { slug: string; name: string; rarity: Rarity; pack?: string }[] = [
  { slug: 'press-start-2p', name: 'Press Start 2P', rarity: 'legendary', pack: 'retro-arcade' }, { slug: 'monoton', name: 'Monoton', rarity: 'legendary', pack: 'retro-arcade' },
  { slug: 'rubik-mono-one', name: 'Rubik Mono One', rarity: 'legendary' }, { slug: 'bungee-shade', name: 'Bungee Shade', rarity: 'legendary' },
  { slug: 'bungee', name: 'Bungee', rarity: 'legendary', pack: 'retro-arcade' },
  { slug: 'abril-fatface', name: 'Abril Fatface', rarity: 'epic', pack: 'elegant-serif' }, { slug: 'cinzel', name: 'Cinzel', rarity: 'epic', pack: 'elegant-serif' },
  { slug: 'zen-dots', name: 'Zen Dots', rarity: 'epic' }, { slug: 'creepster', name: 'Creepster', rarity: 'epic' },
  { slug: 'orbitron', name: 'Orbitron', rarity: 'epic' }, { slug: 'dm-serif-display', name: 'DM Serif Display', rarity: 'epic', pack: 'elegant-serif' },
  { slug: 'bebas-neue', name: 'Bebas Neue', rarity: 'epic' }, { slug: 'anton', name: 'Anton', rarity: 'epic' },
  { slug: 'alfa-slab-one', name: 'Alfa Slab One', rarity: 'epic' }, { slug: 'great-vibes', name: 'Great Vibes', rarity: 'epic', pack: 'elegant-serif' },
  { slug: 'michroma', name: 'Michroma', rarity: 'epic' }, { slug: 'ultra', name: 'Ultra', rarity: 'epic' },
  { slug: 'lobster', name: 'Lobster', rarity: 'rare' }, { slug: 'pacifico', name: 'Pacifico', rarity: 'rare' },
  { slug: 'bangers', name: 'Bangers', rarity: 'rare', pack: 'retro-arcade' }, { slug: 'yeseva-one', name: 'Yeseva One', rarity: 'rare', pack: 'elegant-serif' },
  { slug: 'sacramento', name: 'Sacramento', rarity: 'rare', pack: 'elegant-serif' }, { slug: 'vt323', name: 'VT323', rarity: 'rare', pack: 'retro-arcade' }, { slug: 'caveat', name: 'Caveat', rarity: 'rare' },
];

const DIR = path.join(__dirname, '..', 'assets', 'fonts');

/** Saves the fonts that are not in the shop yet. Returns how many were added; a font whose file is missing or is not a font is left out. */
export async function seedFonts(): Promise<number> {
  let added = 0;
  for (const font of FONTS) {
    try {
      const file = await fs.readFile(path.join(DIR, `${font.slug}-400.woff2`));
      const checked = shopRules.checkFont(file);
      if (!checked.ok) continue;
      if (await shopDb.insertItemIfMissing({ kind: 'font', id: font.slug, names: { en: font.name, es: font.name, 'pt-BR': font.name }, rarity: font.rarity, file, fileType: checked.type, packId: font.pack ?? null })) added += 1;
    } catch { /* a font that cannot be read is skipped: the rest are still saved */ }
  }
  return added;
}

const BANNERS = path.join(__dirname, '..', 'assets', 'shop-banners');
interface SeedBanner { id: string; names: Record<string, string>; pack: string | null; rarity: Rarity | 'common'; price: number | null; credit: string | null }

/**
 * Saves the banners that come with the shop (src/assets/shop-banners, made by scripts/make-shop-banners.js) that are not there yet: the game backgrounds (free for everybody, in the
 * pack "game-backgrounds") and the landscapes that cost ceramos. Returns how many were added. What the team edits afterwards (the name, the price, taking one off sale) is never undone.
 */
export async function seedBanners(): Promise<number> {
  let added = 0;
  let list: SeedBanner[] = [];
  try { list = JSON.parse(await fs.readFile(path.join(BANNERS, 'index.json'), 'utf8')) as SeedBanner[]; } catch { return 0; }
  for (const banner of list) {
    try {
      const file = await fs.readFile(path.join(BANNERS, `${banner.id}.webp`));
      if (await shopDb.insertItemIfMissing({ kind: 'banner', id: banner.id, names: banner.names, rarity: banner.rarity, file, fileType: 'image/webp', packId: banner.pack, price: banner.price, credit: banner.credit })) added += 1;
    } catch { /* one that cannot be read is skipped: the rest are still saved */ }
  }
  return added;
}
