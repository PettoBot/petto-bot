// Checks the buttons of reaction roles: the color the builder chose (or the one of the mode), only an emoji, a button with no emoji,
// and the rows (the ones the builder set in their order, the rest five to a row).
const assert = require('node:assert/strict');
const { ButtonStyle } = require('discord.js');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const database = require.resolve('../src/db/database');
require.cache[database] = { id: database, filename: database, loaded: true, exports: { from: () => ({}) } };
const { buildButtonRows, placeInRows, buttonEmoji } = require('../src/interactions/reactionRoleButton');

const guild = { roles: { cache: new Map([['10', { name: 'Gamer' }], ['11', { name: 'Artist' }]]) } };
let next = 1;
const row = (extra = {}) => ({ id: next++, interaction_type: 'button', emoji: '🎮', role_id: '10', mode: 'toggle', button_label: null, button_style: null, button_row: null, button_position: null, ...extra });
const json = (rows) => buildButtonRows(rows, guild).map((r) => r.toJSON().components);

// Color: the chosen one, or the one of the mode
let [[a, b, c, d]] = json([row({ button_style: 4 }), row({ emoji: '🎨', mode: 'add' }), row({ emoji: '🖌️', mode: 'remove' }), row({ emoji: '🎵', button_style: 2 })]);
assert.deepEqual([a.style, b.style, c.style, d.style], [ButtonStyle.Danger, ButtonStyle.Success, ButtonStyle.Danger, ButtonStyle.Secondary]);

// Text: its own, the name of the role, or only the emoji
[[a, b, c]] = json([row({ button_label: 'Games' }), row({ emoji: '🎨' }), row({ emoji: '🎵', button_label: '' })]);
assert.equal(a.label, 'Games'); assert.equal(b.label, 'Gamer', 'no text: the name of the role'); assert.equal(c.label, undefined, 'an empty text with an emoji is only the emoji');
assert.equal(c.emoji.name, '🎵');

// A button with no emoji keeps its text, and an empty text with no emoji falls back to the role
[[a, b]] = json([row({ emoji: 'label:ab12cd34', button_label: 'Just text' }), row({ emoji: 'label:ef56ab78', button_label: '' })]);
assert.equal(a.label, 'Just text'); assert.equal(a.emoji, undefined, 'label: is not an emoji');
assert.equal(b.label, 'Gamer', 'a button cannot be empty');
assert.equal(buttonEmoji('label:1'), null);
assert.deepEqual(buttonEmoji('<:rose:123456789012345678>'), { id: '123456789012345678', name: 'rose', animated: false });

// Rows: the builder's rows in their order, positions inside, the rest after, five to a row
const placed = placeInRows([row({ emoji: '1', button_row: 1, button_position: 1 }), row({ emoji: '2', button_row: 1, button_position: 0 }), row({ emoji: '3', button_row: 0 }), row({ emoji: '4' })]);
assert.deepEqual(placed.map((r) => r.map((x) => x.emoji)), [['3'], ['2', '1'], ['4']]);
const many = Array.from({ length: 12 }, (_, n) => row({ emoji: `e${n}` }));
assert.deepEqual(placeInRows(many).map((r) => r.length), [5, 5, 2], 'old buttons are filled five to a row, as before');
assert.equal(placeInRows(Array.from({ length: 7 }, (_, n) => row({ emoji: `s${n}`, button_row: 0, button_position: n }))).map((r) => r.length).join(), '5,2', 'a sixth button in a row goes to the next');

// Limits
assert.throws(() => buildButtonRows(Array.from({ length: 26 }, (_, n) => row({ emoji: `x${n}` })), guild), /at most 25/);
assert.throws(() => buildButtonRows([0, 1, 2, 3, 4].map((place) => row({ emoji: `r${place}`, button_row: place })).concat([row({ emoji: 'extra' })]), guild), /at most 5 rows/, 'five rows are full');
console.log('Checked the reaction role buttons: colors, texts, no-emoji buttons and rows.');
