// The card of /serverinfo: what it says, the limits of a V2 message and the buttons.
const assert = require('node:assert/strict');
const { buildServerInfoCard, serverInfoPayload, boostText, featureList } = require('../src/utils/serverInfoCard');

const data = {
  name: 'Petto Land', id: '123456789012345678', description: 'A cozy place for friends and bots.', createdTimestamp: Date.UTC(2021, 1, 3),
  ownerId: '111', iconUrl: 'https://cdn.example/i.png', bannerUrl: 'https://cdn.example/b.png', splashUrl: null, vanityUrl: 'https://discord.gg/petto',
  memberCount: 1234, humans: 1100, bots: 134, boosters: 42, boosts: 9, tier: 2, verification: 'Medium', locale: 'en-US',
  textChannels: 20, forumChannels: 2, voiceChannels: 6, categories: 5, roles: 31, emojis: 40, emojiLimit: 150, stickers: 3, stickerLimit: 15,
  features: ['COMMUNITY', 'VANITY_URL', 'SOMETHING_UNKNOWN'], shard: 1, shards: 1,
};

assert.equal(boostText(0, 0), 'No level  ·  0 boosts (2 more for level 1)');
assert.equal(boostText(2, 9), 'Level 2  ·  9 boosts (5 more for level 3)');
assert.equal(boostText(3, 20), 'Level 3  ·  20 boosts', 'the top level has nothing more to reach');
assert.equal(featureList(['COMMUNITY', 'X']), 'Community', 'a feature nobody knows is left out');
assert.equal(featureList(['X']), null);
assert.match(featureList(Array(10).fill(0).map((_, i) => ['COMMUNITY', 'PARTNERED', 'VERIFIED', 'DISCOVERABLE', 'VANITY_URL', 'ANIMATED_ICON', 'BANNER', 'ROLE_ICONS', 'NEWS', 'ANIMATED_BANNER'][i])), /and 4 more$/);

const json = buildServerInfoCard(data).toJSON();
assert.equal(json.type, 17, 'a container');
const text = JSON.stringify(json);
for (const part of ['Petto Land', 'A cozy place', '1,234', '1,100 people', '134 bots', 'Boosters', '20 text', '2 forums', 'Level 2', '31/250 roles', '40/150 emojis', 'Community, Vanity link', 'Shard 1/1']) assert.ok(text.includes(part), `the card says ${part}`);
assert.ok(!text.includes('Invite splash'), 'a server with no splash has no button for it');
const buttons = json.components.find((component) => component.type === 1).components;
assert.deepEqual(buttons.map((button) => button.label), ['Icon', 'Banner', 'Server link']);
assert.ok(buttons.length <= 5);
assert.ok(json.components.some((component) => component.type === 12), 'the banner is a media gallery');

const plain = JSON.stringify(buildServerInfoCard({ ...data, description: null, bannerUrl: null, iconUrl: null, vanityUrl: null, humans: null, bots: null, boosters: null, features: [] }).toJSON());
assert.ok(!plain.includes('people') && !plain.includes('Boosters') && !plain.includes('Features'), 'what is not known is not shown');
const longName = buildServerInfoCard({ ...data, name: 'x'.repeat(500), description: 'y'.repeat(900) }).toJSON();
const total = JSON.stringify(longName).length;
assert.ok(total < 6000, 'a long name and description are cut');
assert.equal(serverInfoPayload(data).flags, 32768);

// The card in Spanish and Portuguese: same layout, translated words and the numbers of each language.
assert.equal(boostText(2, 9, 'es'), 'Nivel 2  ·  9 boosts (faltan 5 para el nivel 3)');
assert.equal(boostText(0, 1, 'pt-BR'), 'Sem nível  ·  1 impulso (falta 1 para o nível 1)');
assert.equal(featureList(['COMMUNITY', 'VANITY_URL'], 6, 'es'), 'Comunidad, Enlace personalizado');
const spanish = JSON.stringify(buildServerInfoCard({ ...data, lang: 'es' }).toJSON());
for (const part of ['**Miembros** 1,234', '1,100 personas', '20 de texto', '2 foros', 'Verificación: Medium', '31/250 roles', 'Shard 1/1']) assert.ok(spanish.includes(part), `the Spanish card says ${part}`);
const portuguese = buildServerInfoCard({ ...data, lang: 'pt-BR' }).toJSON();
assert.ok(JSON.stringify(portuguese).includes('1.234') && JSON.stringify(portuguese).includes('31/250 cargos'));
assert.deepEqual(portuguese.components.find((component) => component.type === 1).components.map((button) => button.label), ['Ícone', 'Banner', 'Link do servidor']);
console.log('Checked the card of /serverinfo.');
