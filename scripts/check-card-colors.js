// Checks the look rules of the cards: no color on the side except green (it went well) and red (refused, or needs attention) and the
// colors of the sanction cards, no big titles (# and ##) in the texts, and every sanction type having all its parts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
const sources = walk('src');

const { COLORS, semanticColor, colorFromText } = require('../src/utils/colors');
const { EMOJI, TYPE_EMOJI, TYPE_BAR } = require('../src/utils/emojis');
const caseCard = require('../src/utils/caseCard');
const infoCard = require('../src/utils/infoCard');
const { plainCard } = require('../src/utils/plainCard');

// The rule: green and red only.
assert.equal(semanticColor(COLORS.GREEN), COLORS.GREEN);
assert.equal(semanticColor(COLORS.RED), COLORS.RED);
for (const other of [COLORS.YELLOW, COLORS.DEFAULT, 0x5865f2, 0xf0a88f, 0x8c7cff, null, undefined, 'x']) assert.equal(semanticColor(other), null, `${other} is not a color of a card`);
assert.equal(colorFromText(`${EMOJI.APPROVE} Done`), COLORS.GREEN);
assert.equal(colorFromText(`${EMOJI.DENY} No`), COLORS.RED);
assert.equal(colorFromText(`${EMOJI.WARNING} Careful`), COLORS.RED);
assert.equal(colorFromText(`Something ${EMOJI.APPROVE} in the middle`), null, 'only the icon that starts the text counts');
assert.equal(colorFromText('Plain text'), null);

const accentOf = (container) => container.toJSON().accent_color ?? null;
assert.equal(accentOf(caseCard.textCard('Plain', 0x4b4f59)), null, 'a grey card has no color');
assert.equal(accentOf(caseCard.textCard('Plain', 0xfed53c)), null, 'a yellow card has no color');
assert.equal(accentOf(caseCard.textCard('Plain', COLORS.GREEN)), COLORS.GREEN);
assert.equal(accentOf(caseCard.textCard(`${EMOJI.APPROVE} Saved`)), COLORS.GREEN, 'a confirmation is green');
assert.equal(accentOf(caseCard.textCard(`${EMOJI.DENY} Refused`, 0x4b4f59)), COLORS.RED, 'a refusal is red');
assert.equal(accentOf(caseCard.textCard('Warned 3 people', 0xfed53c, { keep: true })), COLORS.YELLOW, 'a sanction card keeps its color');
assert.equal(accentOf(infoCard.buildInfoCard({ title: 'x' })), null, 'an info card has no color');
assert.equal(accentOf(infoCard.buildInfoCard({ title: 'x', accent: 0x8c7cff })), null);
assert.equal(accentOf(infoCard.buildInfoCard({ title: 'x', accent: COLORS.RED })), COLORS.RED);
assert.equal(accentOf(plainCard('Plain', 0xffd563).components[0]), null);
assert.equal(accentOf(plainCard(`${EMOJI.APPROVE} ok`).components[0]), COLORS.GREEN);
assert.equal(accentOf(infoCard.noticePayload('Nothing here').components[0]), null);

// No decorative color is written in the code: a hex literal given to a card must be one of the greens and reds (or the yellow of a sanction).
const allowed = new Set(['0xa5ea7a', '0xfe6465', '0xff6b6b', '0xff2d2d', '0xfed53c']);
const decorative = [];
for (const file of sources) {
  const text = read(file);
  for (const match of text.matchAll(/(?:setAccentColor|textCard|plainCard)\([^)]*?(0x[0-9a-fA-F]{6})/g)) {
    if (!allowed.has(match[1].toLowerCase())) decorative.push(`${file}: ${match[1]}`);
  }
}
assert.deepEqual(decorative, [], `cards with a color that is not green or red:\n${decorative.join('\n')}`);

// No big titles: a text may use **bold** or ### but not # or ##.
const headings = [];
for (const file of sources) {
  read(file).split('\n').forEach((line, index) => {
    if (/(['"`]|\\n)#{1,2} (?![#])/.test(line) && !/-# /.test(line.split(/#{1,2} /)[0].slice(-3))) headings.push(`${file}:${index + 1}`);
  });
}
assert.deepEqual(headings, [], `texts with a # or ## title:\n${headings.join('\n')}`);

// Every sanction type has its icon, its bar, its color, its sentence in the DM and in the confirmation, in the three languages.
const schemaTypes = /type\s+text not null check \(type in \(([^)]*)\)\)/.exec(read('src/db/schema.sql'))[1].match(/'([a-z]+)'/g).map((v) => v.slice(1, -1)).sort();
assert.ok(schemaTypes.length >= 12, 'the types of the cases were read from the schema');
const keysOf = (obj) => Object.keys(obj).sort();
assert.deepEqual(keysOf(caseCard.COLORS), schemaTypes, 'every type of case has a color');
assert.deepEqual(keysOf(TYPE_EMOJI), schemaTypes, 'every type of case has an icon');
assert.deepEqual(keysOf(TYPE_BAR), schemaTypes, 'every type of case has a bar');
const setOf = (file, name) => new Set(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(read(file))[1].match(/'([a-z]+)'/g).map((v) => v.slice(1, -1)));
for (const [file, name] of [['src/utils/sanctionMessage.js', 'DM_TYPES'], ['src/utils/caseCard.js', 'CONFIRM_TYPES']]) assert.deepEqual([...setOf(file, name)].sort(), schemaTypes, `${name} has every type of case`);
for (const type of schemaTypes) assert.ok(Object.values(COLORS).includes(caseCard.COLORS[type]), `${type} has a color of the palette`);
const timed = ['tempban', 'tempmute'];
for (const lang of ['en', 'es', 'pt-BR']) {
  const catalog = require(`../src/i18n/locales/${lang}/moderation.js`);
  const strings = catalog.default ?? catalog;
  for (const type of schemaTypes) {
    for (const kind of ['card', 'dm']) assert.ok(strings[`moderation.${kind}.${type}`], `${lang}: moderation.${kind}.${type}`);
  }
  for (const type of timed) for (const kind of ['card', 'dm']) assert.ok(strings[`moderation.${kind}.${type}Timed`] || strings[`moderation.${kind}.${type}`], `${lang}: the timed sentence of ${type}`);
}
console.log('Checked the colors and titles of the cards, and that every sanction type has its parts.');
