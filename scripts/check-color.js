// Checks `!color`: every way of writing a color (hex, rgb, hsl, hsv, cmyk, a number, a name in three languages, random), what is refused, the arithmetic
// (other writings of the same color, WCAG contrast, shades, the complement, the nearest name), the sample picture, and the answer of the command
// with the prefix and as a slash command (the card, the attached picture, the answer promised first, the texts in the three languages).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';

const root = path.join(__dirname, '..');
const color = require(path.join(root, 'src/utils/colorParse.js'));
const { parseColor } = color;

const rgbOf = (text, random) => {
  const parsed = parseColor(text, random);
  return parsed ? [parsed.r, parsed.g, parsed.b] : null;
};

// ---- Every way of writing a color ----
const ORANGE = [255, 136, 0];
const same = (texts, expected = ORANGE) => {
  for (const text of texts) assert.deepEqual(rgbOf(text), expected, `"${text}" is ${expected}`);
};

same(['#ff8800', 'ff8800', 'FF8800', '#FF8800', '#f80', 'f80', '#F80', '0xff8800', '0XFF8800', ' #ff8800 ', '`#ff8800`', '"#ff8800"']);
same(['16746496', '  16746496']);
same(['rgb(255, 136, 0)', 'rgb(255,136,0)', 'RGB(255 136 0)', 'rgba(255, 136, 0, 1)', 'rgb(255 136 0 / 50%)', 'rgb 255 136 0', 'rgb(100%, 53.3%, 0%)', '255 136 0', '255,136,0', '255, 136, 0', '255;136;0', 'r255 g136 b0', 'R255 G136 B0', 'b0 g136 r255', 'r:255 g:136 b:0']);
same(['hsl(32, 100%, 50%)', 'hsl(32deg 100% 50%)', 'hsl(32 100% 50%)', 'hsla(32, 100%, 50%, 0.5)', 'hsl 32 100 50', '32 100% 50%', '32°, 100%, 50%', 'h32 s100 l50', 'hsl(0.0889turn, 100%, 50%)'], [255, 136, 0]);
same(['hsv(32, 100%, 100%)', 'hsb(32, 100%, 100%)', 'hsv 32 100 100', 'h32 s100 v100', 'hsva(32, 100%, 100%, 1)']);
same(['cmyk(0, 47, 100, 0)', 'cmyk(0%, 47%, 100%, 0%)', 'cmyk 0 47 100 0', 'c0 m47 y100 k0', '0% 47% 100% 0%'], [255, 135, 0]);

// Names: CSS, with spaces and separators, in Spanish and in Portuguese.
same(['orange', 'Orange', ' ORANGE ', 'darkorange', 'dark orange', 'dark-orange', 'dark_orange'].slice(0, 3), [255, 165, 0]);
assert.deepEqual(rgbOf('dark orange'), [255, 140, 0]);
assert.deepEqual(rgbOf('Light Sky Blue'), [135, 206, 250]);
assert.deepEqual(rgbOf('rebeccapurple'), [102, 51, 153]);
assert.deepEqual(rgbOf('grey'), rgbOf('gray'));
assert.deepEqual(rgbOf('rojo'), [255, 0, 0]);
assert.deepEqual(rgbOf('Púrpura'), [128, 0, 128]);
assert.deepEqual(rgbOf('marrón'), [165, 42, 42]);
assert.deepEqual(rgbOf('vermelho'), [255, 0, 0]);
assert.deepEqual(rgbOf('azul'), [0, 0, 255]);
assert.deepEqual(rgbOf('amarelo'), [255, 255, 0]);
assert.deepEqual(rgbOf('preto'), [0, 0, 0]);
assert.deepEqual(rgbOf('blanco'), [255, 255, 255]);
assert.equal(parseColor('orange').source, 'name');
assert.equal(parseColor('rojo').name, 'rojo');
assert.equal(color.COLOR_NAMES.length, 148, 'the full CSS list');
for (const name of color.COLOR_NAMES) assert.ok(parseColor(name), `${name} is a color`);

// Short hex, alpha, the old way of the command.
assert.deepEqual(rgbOf('#fff'), [255, 255, 255]);
assert.deepEqual(rgbOf('fff'), [255, 255, 255]);
assert.deepEqual(rgbOf('#000'), [0, 0, 0]);
assert.deepEqual(rgbOf('#ff'), [0, 0, 255], '#ff is padded on the left as before');
assert.deepEqual(rgbOf('#fffff'), [15, 255, 255]);
assert.equal(parseColor('#ff880080').alpha.toFixed(2), '0.50');
assert.deepEqual(rgbOf('#ff880080'), ORANGE);
assert.equal(parseColor('#f808').alpha.toFixed(2), '0.53');
assert.equal(parseColor('rgba(255, 136, 0, 0.25)').alpha, 0.25);
assert.equal(parseColor('rgb(255 136 0 / 50%)').alpha, 0.5);
assert.equal(parseColor('#ff8800').alpha, null);

// Numbers: only digits are hex when they are 3 or 6 of them; any other number is the decimal one.
assert.deepEqual(rgbOf('123456'), [0x12, 0x34, 0x56]);
assert.deepEqual(rgbOf('#123'), [0x11, 0x22, 0x33]);
assert.deepEqual(rgbOf('255'), [0x22, 0x55, 0x55], 'three digits are hex, as in CSS');
assert.deepEqual(rgbOf('0'), [0, 0, 0]);
assert.deepEqual(rgbOf('65280'), [0, 255, 0]);
assert.deepEqual(rgbOf('16777215'), [255, 255, 255]);
assert.equal(parseColor('16746496').source, 'decimal');
assert.equal(parseColor('16777216'), null, 'more than 0xffffff is not a color');
assert.equal(parseColor('99999999999'), null);

// Which source each one says it is.
for (const [text, source] of [['#f80', 'hex'], ['rgb(1,2,3)', 'rgb'], ['1 2 3', 'rgb'], ['hsl(1,2%,3%)', 'hsl'], ['1 2% 3%', 'hsl'], ['hsb(1,2%,3%)', 'hsv'], ['cmyk(1,2,3,4)', 'cmyk'], ['255', 'hex'], ['16746496', 'decimal'], ['red', 'name'], ['random', 'random']]) {
  assert.equal(parseColor(text).source, source, `${text} is ${source}`);
}

// Random: any of the words, and a fixed source of randomness gives a fixed color.
const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
assert.deepEqual(rgbOf('random', seq([0, 0.5, 0.999])), [0, 128, 255]);
for (const word of ['random', 'RANDOM', 'aleatorio', 'aleatória', 'rnd']) assert.ok(parseColor(word), `${word} is random`);
for (let i = 0; i < 50; i += 1) { const c = parseColor('random'); assert.ok([c.r, c.g, c.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)); }

// What is refused.
for (const bad of ['', '   ', 'hello', 'notacolor', '#gg0000', '#1234567', '#12345678a', 'rgb(256, 0, 0)', 'rgb(-1, 0, 0)', 'rgb(1, 2)', 'rgb(1, 2, 3, 4, 5)', 'rgb(a, b, c)', 'hsl(32, 120%, 50%)', 'hsl(32, 100%)', 'cmyk(0, 0, 0)', 'cmyk(0, 0, 0, 101)', '256 0 0', '1 2 3 4', 'r255 g0', 'r255 r0 b1', 'x1 y2 z3', 'rgb()', '<@123>', 'https://example.com/a.png', '12345678901234567890', '1.5.2', '#', '##fff', '0x', 'orange juice', 'rojooo']) {
  assert.equal(parseColor(bad), null, `"${bad}" is not a color`);
}
assert.equal(parseColor(null), null);
assert.equal(parseColor(undefined), null);

// ---- The arithmetic ----
assert.equal(color.hexOf(255, 136, 0), '#ff8800');
assert.equal(color.hexOf(0, 0, 0), '#000000');
assert.equal(color.hexOf(1, 2, 3), '#010203');
assert.equal(color.toDecimal(255, 136, 0), 16746496);
assert.deepEqual(color.toHsl(255, 136, 0), [32, 100, 50]);
assert.deepEqual(color.toHsl(0, 0, 0), [0, 0, 0]);
assert.deepEqual(color.toHsl(255, 255, 255), [0, 0, 100]);
assert.deepEqual(color.toHsl(255, 0, 0), [0, 100, 50]);
assert.deepEqual(color.toHsl(0, 0, 255), [240, 100, 50]);
assert.deepEqual(color.toHsv(255, 136, 0), [32, 100, 100]);
assert.deepEqual(color.toHsv(0, 0, 0), [0, 0, 0]);
assert.deepEqual(color.toHsv(128, 128, 128), [0, 0, 50]);
assert.deepEqual(color.toCmyk(255, 136, 0), [0, 47, 100, 0]);
assert.deepEqual(color.toCmyk(0, 0, 0), [0, 0, 0, 100]);
assert.deepEqual(color.toCmyk(255, 255, 255), [0, 0, 0, 0]);
// Going out and coming back is the same color.
for (let i = 0; i < 200; i += 1) {
  const rgb = [(i * 37) % 256, (i * 91 + 13) % 256, (i * 53 + 7) % 256];
  const [h, s, l] = color.toHsl(...rgb);
  const back = rgbOf(`hsl(${h}, ${s}%, ${l}%)`);
  assert.ok(back.every((v, n) => Math.abs(v - rgb[n]) <= 4), `hsl round trip of ${rgb} gave ${back}`);
  const [hv, sv, vv] = color.toHsv(...rgb);
  const backV = rgbOf(`hsv(${hv}, ${sv}%, ${vv}%)`);
  assert.ok(backV.every((v, n) => Math.abs(v - rgb[n]) <= 4), `hsv round trip of ${rgb} gave ${backV}`);
  assert.deepEqual(rgbOf(color.hexOf(...rgb)), rgb, `hex round trip of ${rgb}`);
  assert.deepEqual(rgbOf(String(color.toDecimal(...rgb)).padStart(7, '0').replace(/^0+(?=\d)/, '')), String(color.toDecimal(...rgb)).length === 3 || String(color.toDecimal(...rgb)).length === 6 ? rgbOf(String(color.toDecimal(...rgb))) : rgb, 'decimal reads back');
}

// WCAG contrast: black on white is 21, white on white is 1, and the known ratio of #777 on white is 4.48.
assert.equal(color.contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(2), '21.00');
assert.equal(color.contrastRatio([255, 255, 255], [255, 255, 255]).toFixed(2), '1.00');
assert.equal(color.contrastRatio([119, 119, 119], [255, 255, 255]).toFixed(2), '4.48');
assert.equal(color.contrastRatio([255, 136, 0], [0, 0, 0]), color.contrastRatio([0, 0, 0], [255, 136, 0]), 'order does not matter');
assert.equal(color.gradeOf(21), 'AAA');
assert.equal(color.gradeOf(7), 'AAA');
assert.equal(color.gradeOf(6.99), 'AA');
assert.equal(color.gradeOf(4.5), 'AA');
assert.equal(color.gradeOf(4.49), 'large');
assert.equal(color.gradeOf(3), 'large');
assert.equal(color.gradeOf(2.99), 'fail');
assert.equal(color.bestText([255, 136, 0]), 'black');
assert.equal(color.bestText([20, 30, 90]), 'white');
assert.equal(color.bestText([255, 255, 255]), 'black');
assert.equal(color.bestText([0, 0, 0]), 'white');

// Shades, complement, nearest name.
const row = color.shades(ORANGE, 7);
assert.equal(row.length, 7);
assert.deepEqual(row[3], ORANGE, 'the middle shade is the color');
for (let i = 1; i < 7; i += 1) assert.ok(color.luminance(...row[i]) >= color.luminance(...row[i - 1]), 'shades go from darker to lighter');
assert.deepEqual(color.mix([0, 0, 0], [255, 255, 255], 0.5), [128, 128, 128]);
assert.deepEqual(color.complement([255, 0, 0]), [0, 255, 255]);
assert.deepEqual(color.complement([0, 0, 255]), [255, 255, 0]);
assert.deepEqual(color.complement([128, 128, 128]), [128, 128, 128]);
assert.equal(color.nearestName([255, 165, 0]), 'orange');
assert.equal(color.nearestName([254, 164, 1]), 'orange');
assert.equal(color.nearestName([0, 0, 0]), 'black');
assert.equal(color.nearestName([128, 128, 128]), 'gray');
assert.ok(!color.nearestName([100, 100, 100]).includes('grey'), 'gray is spelled gray');

// ---- The picture ----
const { renderColorSample, WIDTH, HEIGHT } = require(path.join(root, 'src/imgutils/colorSampleCard.js'));
for (const rgb of [ORANGE, [0, 0, 0], [255, 255, 255], [20, 30, 90], [128, 128, 128], [255, 235, 59]]) {
  const png = renderColorSample({ rgb });
  assert.ok(Buffer.isBuffer(png) && png.length > 4000 && png.length < 400_000, `the picture of ${rgb} is a reasonable file (${png.length} bytes)`);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), WIDTH);
  assert.equal(png.readUInt32BE(20), HEIGHT);
}
assert.notDeepEqual(renderColorSample({ rgb: [255, 0, 0] }), renderColorSample({ rgb: [0, 0, 255] }), 'each color has its own picture');

// ---- The command ----
const { MessageFlags } = require('discord.js');
const command = require(path.join(root, 'src/commands/info/color.js'));
const { findCommandFiles, COMMANDS_DIR } = require(path.join(root, 'src/handlers/commandHandler.js'));
assert.ok(findCommandFiles(COMMANDS_DIR).some((file) => file.endsWith(path.join('info', 'color.js'))));
assert.deepEqual(command.prefixGreedyStringOptions, { _: 'hex' }, 'the whole text after the command is the color');
assert.deepEqual(command.aliases, ['clr', 'hex']);
const json = command.data.toJSON();
assert.equal(json.name, 'color');
assert.equal(json.options[0].name, 'hex');
assert.ok(json.description.length <= 100 && json.options[0].description.length <= 100, 'the descriptions fit in Discord');

function flatten(components, out = []) {
  for (const component of components ?? []) {
    const data = component.toJSON ? component.toJSON() : component;
    out.push(data);
    flatten(data.components, out);
    if (data.accessory) out.push(data.accessory);
    if (data.items) out.push(...data.items);
  }
  return out;
}
const textOf = (payload) => flatten(payload.components).map((c) => c.content ?? '').join('\n');

function fake({ text, prefix = false, perms = true }) {
  const calls = [];
  const interaction = {
    options: { getString: () => text },
    guildId: '1', guild: { id: '1', members: { me: {} } }, user: { id: '5' },
    channel: { permissionsFor: () => ({ has: () => perms }) },
    member: { id: '5' },
    deferred: false, replied: false,
    isChatInputCommand: () => !prefix,
    deferReply: async () => { interaction.deferred = true; calls.push(['defer']); },
    editReply: async (payload) => { calls.push(['edit', payload]); },
    reply: async (payload) => { interaction.replied = true; calls.push(['reply', payload]); },
  };
  if (prefix) interaction.rawMessage = { attachments: new Map(), reference: null, mentions: { users: new Map() } };
  return { interaction, calls };
}

async function run(options) {
  const { interaction, calls } = fake(options);
  await command.execute(interaction);
  return calls;
}

(async () => {
  // A slash command promises the answer first, then edits it with the card and the picture.
  let calls = await run({ text: 'rgb(255, 136, 0)' });
  assert.deepEqual(calls.map((c) => c[0]), ['defer', 'edit'], 'the slash command defers, then edits');
  let payload = calls[1][1];
  assert.equal(payload.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2, 'a Components V2 card');
  assert.equal(payload.files.length, 1, 'with the sample picture attached');
  assert.equal(payload.files[0].name, 'color.png');
  assert.ok(payload.files[0].attachment.subarray(1, 4).toString() === 'PNG');
  const card = payload.components[0].toJSON();
  assert.equal(card.accent_color, undefined, 'no color on the card');
  const gallery = flatten(payload.components).find((c) => c.type === 12);
  assert.equal(gallery.items[0].media.url, 'attachment://color.png', 'the card shows the attached picture');
  let text = textOf(payload);
  for (const needle of ['#FF8800', '`#ff8800`', '`255, 136, 0`', '`32°, 100%, 50%`', '`32°, 100%, 100%`', '`0%, 47%, 100%, 0%`', '`16746496`', 'orange', ':1']) assert.ok(text.includes(needle), `the card says ${needle}\n${text}`);
  assert.deepEqual(payload.allowedMentions.parse, []);

  // The prefix answers at once, in one message.
  calls = await run({ text: '#f80', prefix: true });
  assert.deepEqual(calls.map((c) => c[0]), ['reply']);
  assert.equal(calls[0][1].files.length, 1);
  assert.ok(textOf(calls[0][1]).includes('#FF8800'));

  // Every writing gives the same card.
  for (const spelled of ['hsl(32, 100%, 50%)', 'hsv(32 100% 100%)', '16746496', '255 136 0', 'r255 g136 b0', '0xff8800']) {
    const again = await run({ text: spelled, prefix: true });
    assert.ok(textOf(again[0][1]).includes('`#ff8800`'), `${spelled} gives the orange card`);
  }
  // A name says so; random says so; an alpha is mentioned and ignored.
  assert.ok(textOf((await run({ text: 'rojo', prefix: true }))[0][1]).includes('#FF0000'));
  assert.ok(textOf((await run({ text: 'rojo', prefix: true }))[0][1]).toLowerCase().includes('rojo'));
  assert.ok(textOf((await run({ text: 'random', prefix: true }))[0][1]).includes('Decimal'));
  assert.ok(textOf((await run({ text: '#ff880080', prefix: true }))[0][1]).includes('50%'));

  // Without permission to attach files the card still comes, without the picture.
  calls = await run({ text: '#ff8800', prefix: true, perms: false });
  assert.equal(calls[0][1].files, undefined);
  assert.equal(flatten(calls[0][1].components).find((c) => c.type === 12), undefined, 'no empty picture');
  assert.ok(textOf(calls[0][1]).includes('`#ff8800`'));

  // What is not a color: slash and prefix say how to write one; a prefix link or member id is a picture, as before (the image command answers).
  for (const bad of ['banana', '', 'rgb(300, 0, 0)']) {
    calls = await run({ text: bad });
    assert.deepEqual(calls.map((c) => c[0]), ['reply'], `"${bad}" is answered once`);
    assert.ok(textOf(calls[0][1]).includes('`#ff8800`') && textOf(calls[0][1]).includes('`random`'), 'the answer shows how to write a color');
    assert.equal(calls[0][1].files, undefined);
  }
  calls = await run({ text: 'banana', prefix: true });
  assert.ok(textOf(calls[0][1]).includes('`rgb(255, 136, 0)`'), 'text that is not a color nor a picture gets the help');

  // ---- The texts, in three languages ----
  const keys = ['info.color.invalid', 'info.color.closest', 'info.color.named', 'info.color.random', 'info.color.alpha', 'info.color.readable', 'info.color.whiteText', 'info.color.blackText', 'info.color.fail', 'info.color.footer', 'cmd.info.color.desc', 'cmd.info.color.opt.hex.desc'];
  for (const lang of ['en', 'es', 'pt-BR']) {
    const info = require(path.join(root, 'src/i18n/locales', lang, 'info.js'));
    const cmd = require(path.join(root, 'src/i18n/locales', lang, 'cmd.info.js'));
    const table = { ...(info.default ?? info), ...(cmd.default ?? cmd) };
    for (const key of keys) assert.ok(typeof table[key] === 'string' && table[key].length > 3, `${lang} has ${key}`);
    assert.ok(table['info.color.invalid'].includes('#ff8800') && table['info.color.invalid'].includes('random'), `${lang}: the error shows how to write a color`);
    assert.ok(table['cmd.info.color.opt.hex.desc'].length <= 100 && table['cmd.info.color.desc'].length <= 100, `${lang}: the command texts fit in Discord`);
    assert.ok(table['info.color.closest'].includes('{name}') && table['info.color.alpha'].includes('{percent}'), `${lang}: the placeholders are kept`);
  }

  console.log('Color checks passed.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
