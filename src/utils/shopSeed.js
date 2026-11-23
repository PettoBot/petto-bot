"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FONTS = void 0;
exports.seedFonts = seedFonts;
// i18n-ignore-file: the names of the fonts are proper names, never translated.
// The name fonts the shop of the profile starts with: the ones of the name customization of Vetox (the same families, free Google fonts), by the three levels of rarity they
// have there. The bot saves them into the shop the first time it starts (`shop_items`), and from then on the editor of the team owns them: renaming one, changing its price
// or taking it off sale is never undone by a restart.
// Written in TypeScript: `npm run build:ts` compiles it over utils/shopSeed.js.
const fs = require('node:fs/promises');
const path = require('node:path');
const shopDb = require('../db/shop');
const shopRules = require('./shopRules');
/** `slug` is the file in src/assets/fonts (`<slug>-400.woff2`) and the id in the shop. */
exports.FONTS = [
    { slug: 'press-start-2p', name: 'Press Start 2P', rarity: 'legendary' }, { slug: 'monoton', name: 'Monoton', rarity: 'legendary' },
    { slug: 'rubik-mono-one', name: 'Rubik Mono One', rarity: 'legendary' }, { slug: 'bungee-shade', name: 'Bungee Shade', rarity: 'legendary' },
    { slug: 'bungee', name: 'Bungee', rarity: 'legendary' },
    { slug: 'abril-fatface', name: 'Abril Fatface', rarity: 'epic' }, { slug: 'cinzel', name: 'Cinzel', rarity: 'epic' },
    { slug: 'zen-dots', name: 'Zen Dots', rarity: 'epic' }, { slug: 'creepster', name: 'Creepster', rarity: 'epic' },
    { slug: 'orbitron', name: 'Orbitron', rarity: 'epic' }, { slug: 'dm-serif-display', name: 'DM Serif Display', rarity: 'epic' },
    { slug: 'bebas-neue', name: 'Bebas Neue', rarity: 'epic' }, { slug: 'anton', name: 'Anton', rarity: 'epic' },
    { slug: 'alfa-slab-one', name: 'Alfa Slab One', rarity: 'epic' }, { slug: 'great-vibes', name: 'Great Vibes', rarity: 'epic' },
    { slug: 'michroma', name: 'Michroma', rarity: 'epic' }, { slug: 'ultra', name: 'Ultra', rarity: 'epic' },
    { slug: 'lobster', name: 'Lobster', rarity: 'rare' }, { slug: 'pacifico', name: 'Pacifico', rarity: 'rare' },
    { slug: 'bangers', name: 'Bangers', rarity: 'rare' }, { slug: 'yeseva-one', name: 'Yeseva One', rarity: 'rare' },
    { slug: 'sacramento', name: 'Sacramento', rarity: 'rare' }, { slug: 'vt323', name: 'VT323', rarity: 'rare' }, { slug: 'caveat', name: 'Caveat', rarity: 'rare' },
];
const DIR = path.join(__dirname, '..', 'assets', 'fonts');
/** Saves the fonts that are not in the shop yet. Returns how many were added; a font whose file is missing or is not a font is left out. */
async function seedFonts() {
    let added = 0;
    for (const font of exports.FONTS) {
        try {
            const file = await fs.readFile(path.join(DIR, `${font.slug}-400.woff2`));
            const checked = shopRules.checkFont(file);
            if (!checked.ok)
                continue;
            if (await shopDb.insertItemIfMissing({ kind: 'font', id: font.slug, names: { en: font.name, es: font.name, 'pt-BR': font.name }, rarity: font.rarity, file, fileType: checked.type }))
                added += 1;
        }
        catch { /* a font that cannot be read is skipped: the rest are still saved */ }
    }
    return added;
}
