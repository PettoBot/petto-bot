// The ship card and message: the name of the pair, the eight steps in the three languages, the message above the card and the
// picture drawn in code (a PNG of the expected size, light, for normal, long and emoji names and for avatars that do not load).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';

const { CATALOGS, LANGUAGES, t } = require('../src/i18n');
const { SHIP_TIERS, shipScore, shipTier, shipVerdict, shipLine, shipName, plainName, shipMessage } = require('../src/utils/funGames');
const { THEMES, WIDTH, HEIGHT } = require('../src/imgutils/shipCard');
const { createCanvas } = require('@napi-rs/canvas');

// The name of the pair.
assert.equal(shipName('Julian', 'Maria', 'en'), 'Julia');
assert.equal(shipName('Camilo', 'Valentina', 'en'), 'Camina');
assert.equal(shipName('Pedro', 'Lucía', 'en'), 'Pedía');
assert.equal(shipName('Julian', 'Maria', 'en'), shipName('Julian', 'Maria', 'es'), 'the name does not depend on the language');
assert.notEqual(shipName('Maria', 'Julian', 'en'), shipName('Julian', 'Maria', 'en'), 'the first name gives the beginning');
assert.equal(shipName('Al', 'Bo', 'en'), 'Albo', 'a name of two letters is used whole');
assert.equal(shipName('Julian 🔥✨', '💜 Maria 💜', 'en'), 'Julia', 'emoji are left out');
assert.equal(shipName('xX_Dark_Xx', '~Luna~', 'en'), 'Dana', 'symbols are left out and the first word of 3 letters or more is used');
assert.equal(shipName('Ａｎａ', 'Pablo', 'en'), shipName('Ana', 'Pablo', 'en'), 'wide letters are normal ones');
assert.equal(shipName('Ana María', 'Pedro', 'en'), shipName('Ana', 'Pedro', 'en'));
for (const lang of LANGUAGES) {
  const fallback = t(lang, 'fun.ship.fallbackName');
  assert.notEqual(fallback, 'fun.ship.fallbackName', `${lang} has the fallback name`);
  for (const [a, b] of [['🔥🔥', '😀'], ['', 'Maria'], ['a', 'b'], ['!!!', '???'], ['1', '2'], [null, undefined], ['​‍', 'Luna']]) {
    assert.equal(shipName(a, b, lang), fallback, `${lang}: ${JSON.stringify([a, b])} gets the fallback name`);
  }
}
const long = shipName('Wolfeschlegelsteinhausenbergerdorff', 'Hubert Blaine Wolfeschlegelsteinhausenbergerdorff', 'en');
assert.ok(Array.from(long).length <= 20 && /^\p{Lu}\p{Ll}+$/u.test(long), `a long name stays short: ${long}`);
assert.ok(!/\p{M}{3}/u.test(shipName('ZALGO̶̷̸̡̢', 'Luna', 'en')), 'a stack of accents is cut');
assert.equal(plainName('  A  ​B 🔥 '), 'A B');
assert.equal(plainName('🔥'), '');

// The steps: eight of them, in order, each with a title and two lines in the three languages.
assert.ok(SHIP_TIERS.length >= 8);
assert.equal(SHIP_TIERS[0].min, 0);
SHIP_TIERS.forEach((tier, index) => { if (index) assert.ok(tier.min > SHIP_TIERS[index - 1].min, 'the steps go up'); assert.ok(THEMES[tier.look], `${tier.id} has a card theme`); });
assert.equal(shipTier(0).id, SHIP_TIERS[0].id);
assert.equal(shipTier(100).id, 'soulmates');
assert.equal(shipTier(-5).id, SHIP_TIERS[0].id);
assert.equal(shipTier(1000).id, 'soulmates');
assert.equal(new Set(Array.from({ length: 101 }, (_, score) => shipTier(score).id)).size, SHIP_TIERS.length, 'every step is reached');
for (const lang of LANGUAGES) {
  const seen = new Set();
  for (const tier of SHIP_TIERS) {
    for (const key of [tier.title, `fun.ship.line.${tier.id}.1`, `fun.ship.line.${tier.id}.2`]) {
      const text = CATALOGS[lang][key];
      assert.ok(typeof text === 'string' && text.length > 3 && text !== key, `${lang} has ${key}`);
      assert.ok(!/[\u2013\u2014]/.test(text), `${key} has no dash`);
      seen.add(text);
    }
  }
  assert.equal(seen.size, SHIP_TIERS.length * 3, `${lang}: every title and line is different`);
  assert.ok(CATALOGS[lang]['fun.ship.compat'].includes('{score}') && CATALOGS[lang]['fun.ship.compat'].includes('{a}') && CATALOGS[lang]['fun.ship.compat'].includes('{b}'));
}
assert.equal(shipVerdict(100, 'es'), 'Almas gemelas');
assert.equal(shipLine(50, '1', '2', 'en'), shipLine(50, '2', '1', 'en'), 'the line does not depend on the order');
const variants = new Set(Array.from({ length: 60 }, (_, i) => shipLine(80, String(i), 'x', 'en')));
assert.equal(variants.size, 2, 'both lines of a step are used');

// The message: the name, the compatibility, the line of the step.
for (const lang of LANGUAGES) {
  for (const score of [0, 9, 10, 24, 25, 39, 40, 54, 55, 69, 70, 79, 80, 89, 90, 100]) {
    const lines = shipMessage({ idA: '1', idB: '2', nameA: 'Julian', nameB: 'Maria', score, lang }).split('\n');
    assert.equal(lines.length, 3, `${lang} ${score}: three lines`);
    assert.ok(lines[0].startsWith(shipTier(score).heart) && lines[0].includes('**Julia**'), 'line 1 is the heart and the name of the pair');
    assert.ok(lines[1].includes('**Julian**') && lines[1].includes('**Maria**') && lines[1].includes(`**${score}%**`), 'line 2 is the compatibility');
    assert.ok(lines[2].startsWith(`**${t(lang, shipTier(score).title)}.**`), 'line 3 is the step');
    assert.ok(!/\{[a-z]+\}|undefined|null/.test(lines.join('\n')), 'nothing is left unfilled');
  }
}
assert.ok(shipMessage({ idA: '1', idB: '2', nameA: '**x** @everyone', nameB: '_y_', score: 50, lang: 'en' }).includes('\\*\\*x\\*\\*'), 'markdown in a name is escaped');
assert.equal(shipMessage({ idA: '1', idB: '2', nameA: 'a', nameB: 'b', score: shipScore('1', '2'), lang: 'en' }), shipMessage({ idA: '2', idB: '1', nameA: 'a', nameB: 'b', score: shipScore('2', '1'), lang: 'en' }), 'the same pair gets the same message');

// The picture.
const png = (buffer) => ({ magic: [...buffer.subarray(0, 8)], width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

(async () => {
  const { buildShipCard } = require('../src/imgutils/shipCard');
  const photo = (() => {
    const canvas = createCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < 256; y += 8) for (let x = 0; x < 256; x += 8) { ctx.fillStyle = `rgb(${(x * 7 + y * 3) % 256}, ${(y * 5) % 256}, ${(x * y) % 256})`; ctx.fillRect(x, y, 8, 8); }
    return canvas.toBuffer('image/png');
  })();
  const cases = {
    normal: { avatarA: photo, avatarB: photo, nameA: 'Julian', nameB: 'Maria' },
    long: { avatarA: photo, avatarB: photo, nameA: 'A very long display name that goes on and on', nameB: 'Wolfeschlegelsteinhausenbergerdorff'.repeat(3) },
    emoji: { avatarA: photo, avatarB: photo, nameA: '🔥💜 Luna 💜🔥', nameB: '😀😀😀' },
    missing: { avatarA: '/missing-a.png', avatarB: 'https://127.0.0.1:1/none.png', nameA: 'Ana', nameB: 'B' },
    empty: { avatarA: undefined, avatarB: null, nameA: '', nameB: undefined },
  };
  for (const [label, options] of Object.entries(cases)) {
    for (const score of [0, 8, 24, 30, 62, 85, 97, 100]) {
      const card = await buildShipCard({ ...options, score, shipName: shipName(options.nameA, options.nameB, 'en') });
      const info = png(card);
      assert.deepEqual(info.magic, PNG_MAGIC, `${label} ${score}: a PNG`);
      assert.deepEqual([info.width, info.height], [WIDTH, HEIGHT], `${label} ${score}: the size`);
      assert.ok(card.length < 250 * 1024, `${label} ${score}: ${card.length} bytes is light enough`);
    }
  }
  const again = [await buildShipCard({ ...cases.normal, score: 62, seed: 5 }), await buildShipCard({ ...cases.normal, score: 62, seed: 5 })];
  assert.ok(again[0].equals(again[1]), 'the same pair draws the same card');
  assert.ok(!again[0].equals(await buildShipCard({ ...cases.normal, score: 62, seed: 6 })), 'another seed moves the hearts');
  assert.ok(!again[0].equals(await buildShipCard({ ...cases.normal, score: 97, seed: 5 })), 'another score is another card');
  assert.equal((await buildShipCard({ ...cases.normal, score: 150 })).length > 0, true, 'a score out of range is brought into it');

  // The background photo is gone and nothing points to it.
  assert.ok(!fs.existsSync(path.join(__dirname, '../src/imgutils/fondoship.jpg')), 'the picture of the old card is deleted');
  assert.ok(!fs.readFileSync(path.join(__dirname, '../src/imgutils/shipCard.js'), 'utf8').includes('fondoship'), 'the card does not read it');

  // The command: the message goes above the card, nobody is pinged, and the text alone goes out when the card cannot be drawn.
  const interaction = (replies) => ({
    options: { getUser: (name) => (name === 'first' ? { id: '111', username: 'julian', globalName: 'Julian', displayAvatarURL: () => '/missing.png' } : null) },
    user: { id: '222', username: 'maria', globalName: '@everyone Maria', displayAvatarURL: () => '/missing.png' },
    guild: null,
    deferReply: async () => {},
    editReply: async (payload) => replies.push(payload),
  });
  const replies = [];
  const ship = require('../src/commands/fun/ship');
  await ship.execute({ ...interaction(replies), pettoLang: 'es' });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].files?.[0]?.name, 'ship.png');
  assert.deepEqual(replies[0].allowedMentions, { parse: [] });
  assert.equal(replies[0].content.split('\n').length, 3);
  assert.ok(replies[0].content.includes(`**${shipScore('111', '222')}%**`));
  assert.ok(replies[0].content.split('\n')[2].includes('.**'), 'in Spanish, with the step');

  const shipCardPath = require.resolve('../src/imgutils/shipCard');
  const shipPath = require.resolve('../src/commands/fun/ship');
  const realCard = require.cache[shipCardPath];
  require.cache[shipCardPath] = { id: shipCardPath, filename: shipCardPath, loaded: true, exports: { buildShipCard: async () => { throw new Error('no canvas'); } } };
  delete require.cache[shipPath];
  const quiet = require('../src/utils/logger');
  const warn = quiet.warn;
  quiet.warn = () => {};
  try {
    const fallback = [];
    await require('../src/commands/fun/ship').execute({ ...interaction(fallback), pettoLang: 'pt-BR' });
    assert.equal(fallback.length, 1);
    assert.equal(fallback[0].files, undefined, 'the text alone goes out');
    assert.deepEqual(fallback[0].allowedMentions, { parse: [] });
    assert.ok(fallback[0].content.includes('compatíveis'), 'in Portuguese');
  } finally {
    quiet.warn = warn;
    require.cache[shipCardPath] = realCard;
    delete require.cache[shipPath];
  }

  console.log('check-ship: ok');
})().catch((error) => { console.error(error); process.exit(1); });
