// Writes the banners that come with the shop (src/assets/shop-banners): every picture of the list is cut to 1024 x 320 (the middle of it, never stretched) and saved as WebP, with
// a list (index.json) that has its names, pack, rarity, price and credit. Run it once with the folder that has the original pictures: `node scripts/make-shop-banners.js <folder>`.
// The bot saves them into the shop the first time it starts (utils/shopSeed.ts); what the team edits afterwards is never overwritten.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeBanner } = require('../src/utils/shopImages');

const GAMES = 'game-backgrounds';
const PHOTO = 'Photo · source to confirm';
const L = (en, es = en, pt = en) => ({ en, es, 'pt-BR': pt });
// [file, id, names, pack, rarity, price, credit]
const LIST = [
  ['gtab1.jpg', 'gta-vi-gas-station', L('GTA VI · Gas station', 'GTA VI · Gasolinera', 'GTA VI · Posto de gasolina'), GAMES, 'common', null, '© Rockstar Games / Take-Two'],
  ['gtab2.jpg', 'gta-vi-red-car', L('GTA VI · Red car', 'GTA VI · Auto rojo', 'GTA VI · Carro vermelho'), GAMES, 'common', null, '© Rockstar Games / Take-Two'],
  ['gtaicon.jpg', 'gta-vi-couple', L('GTA VI · Couple', 'GTA VI · Pareja', 'GTA VI · Casal'), GAMES, 'common', null, '© Rockstar Games / Take-Two'],
  ['gta1.jpg', 'gta-vi-palms', L('GTA VI · Palms', 'GTA VI · Palmeras', 'GTA VI · Palmeiras'), GAMES, 'common', null, '© Rockstar Games / Take-Two'],
  ['gta2.jpg', 'gta-vi-collage', L('GTA VI · Collage', 'GTA VI · Collage', 'GTA VI · Colagem'), GAMES, 'common', null, '© Rockstar Games / Take-Two'],
  ['fh6.jpg', 'forza-horizon-6', L('Forza Horizon 6'), GAMES, 'common', null, '© Microsoft / Playground Games'],
  ['fh5.jpg', 'forza-horizon-5', L('Forza Horizon 5'), GAMES, 'common', null, '© Microsoft / Playground Games'],
  ['mc1.jpg', 'minecraft', L('Minecraft'), GAMES, 'common', null, '© Mojang Studios'],
  ['halo1.webp', 'halo-master-chief', L('Halo · Master Chief', 'Halo · Jefe Maestro', 'Halo · Master Chief'), GAMES, 'common', null, '© Microsoft / 343 Industries'],
  ['halo2.jpg', 'halo-infinite-rings', L('Halo Infinite · Rings', 'Halo Infinite · Anillos', 'Halo Infinite · Anéis'), GAMES, 'common', null, '© Microsoft / 343 Industries'],
  ['sanrio1.jpg', 'sanrio-friends', L('Sanrio · Friends', 'Sanrio · Amigos', 'Sanrio · Amigos'), GAMES, 'common', null, '© Sanrio'],
  ['sanrio2.jpg', 'pochacco-picnic', L('Pochacco · Picnic', 'Pochacco · Picnic', 'Pochacco · Piquenique'), GAMES, 'common', null, '© Sanrio'],
  ['sanrio3.jpg', 'cinnamoroll-clouds', L('Cinnamoroll · Clouds', 'Cinnamoroll · Nubes', 'Cinnamoroll · Nuvens'), GAMES, 'common', null, '© Sanrio'],
  ['cod_ghost.jpg', 'cod-ghost', L('Call of Duty · Ghost', 'Call of Duty · Ghost', 'Call of Duty · Ghost'), GAMES, 'common', null, '© Activision'],
  ['cod_price.jpg', 'cod-price', L('Call of Duty · Price', 'Call of Duty · Price', 'Call of Duty · Price'), GAMES, 'common', null, '© Activision'],
  ['land1.png', 'bahrain-sunset', L('Bahrain at sunset', 'Bahréin al atardecer', 'Bahrein ao entardecer'), null, 'rare', 150, PHOTO],
  ['land3.png', 'kuwait-bay', L('Kuwait · Bay', 'Kuwait · Bahía', 'Kuwait · Baía'), null, 'rare', 150, PHOTO],
  ['land5.png', 'istanbul', L('Istanbul', 'Estambul', 'Istambul'), null, 'epic', 200, PHOTO],
  ['land4.png', 'beirut-coast', L('Beirut · Coast', 'Beirut · Costa', 'Beirute · Costa'), null, 'epic', 200, PHOTO],
  ['forest.jpg', 'misty-forest', L('Misty forest', 'Bosque con niebla', 'Floresta com névoa'), null, 'rare', 150, PHOTO],
  ['land2.png', 'rider-in-the-valley', L('Rider in the valley', 'Jinete en el valle', 'Cavaleiro no vale'), null, 'legendary', 300, 'Concept art · author to confirm'],
];

(async () => {
  const from = path.resolve(process.argv[2] ?? '.');
  const out = path.join(__dirname, '..', 'src', 'assets', 'shop-banners');
  fs.mkdirSync(out, { recursive: true });
  const index = [];
  for (const [file, id, names, pack, rarity, price, credit] of LIST) {
    const done = await normalizeBanner(fs.readFileSync(path.join(from, file)), true);
    if (!done.ok) throw new Error(`${file}: ${done.error}`);
    fs.writeFileSync(path.join(out, `${id}.webp`), done.bytes);
    index.push({ id, names, pack, rarity, price, credit });
  }
  fs.writeFileSync(path.join(out, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
  console.log(`${index.length} banners written (${fs.readdirSync(out).length - 1} pictures).`);
})();
