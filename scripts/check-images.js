// The image commands: !quote draws its picture (short, long, accents, emojis, light, color, bold) and every !image effect gives a
// picture of the expected size and format from a generated test image; the text of a quote, where the picture comes from, the
// limits on downloads and the options read from the prefix text.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { quotePieces, isEmptyQuote, shortLink, twemojiCode } = require('../src/utils/quoteText');
const { renderQuote, QUOTE_SIZE } = require('../src/imgutils/quoteCard');
const { EFFECT_NAMES, applyEffect, effectAmount, fitSize, mainColor, renderSwatch, MAX_SIDE } = require('../src/imgutils/imageEffects');
const { imageDimensions, loadInputImage, findImageSource, imageOfMessage, INPUT_LIMITS } = require('../src/utils/imageInput');
const { withRenderSlot, attachFilesProblem } = require('../src/utils/imageCommands');
const { DEFAULT_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');
const image = require('../src/commands/fun/image');
const quote = require('../src/commands/fun/quote');

/** A test picture: a gradient with a red square, `width` by `height`. */
function testImage(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1d4ed8');
  gradient.addColorStop(1, '#f59e0b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#e11d48';
  ctx.fillRect(width * 0.1, height * 0.1, width * 0.4, height * 0.4);
  return canvas;
}

const isPng = (buffer) => buffer.readUInt32BE(0) === 0x89504e47;
const isJpeg = (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8;

(async () => {
  // The text of a quote: mentions as names, links short, Markdown gone, emojis as pieces of their own.
  const names = { user: (id) => (id === '123456789012345678' ? 'Liam' : null), role: () => 'Mods', channel: () => 'general' };
  const pieces = quotePieces('**hola** <@123456789012345678> <@&223456789012345678> <#323456789012345678> mira https://www.youtube.com/watch?v=x 😂 <:pepe:423456789012345678>', names);
  const text = pieces.filter((piece) => piece.type === 'text').map((piece) => piece.text).join('');
  assert.ok(text.startsWith('hola @Liam @Mods #general mira youtube.com/…'), text);
  assert.deepEqual(pieces.filter((piece) => piece.type === 'emoji').map((piece) => piece.key), ['twemoji:1f602', 'custom:423456789012345678']);
  assert.equal(quotePieces('<@999999999999999999>')[0].text, '@user', 'an unknown member is still written as a mention');
  assert.equal(twemojiCode('❤️'), '2764', 'the emoji selector is dropped outside ZWJ sequences');
  assert.equal(twemojiCode('👨‍👩‍👧'), '1f468-200d-1f469-200d-1f467');
  assert.equal(quotePieces('© 2024')[0].text, '© 2024', 'a plain © is text, not an emoji');
  assert.equal(shortLink('https://example.com'), 'example.com');
  assert.ok(isEmptyQuote(quotePieces('  ** **  ')));
  assert.ok(quotePieces('a'.repeat(5000))[0].text.length <= 600, 'a long message is cut before it is laid out');

  // The quote picture, in every look, is a PNG of the same size.
  const avatar = testImage(300, 300);
  const fakeEmoji = testImage(72, 72);
  const samples = {
    short: 'ya me voy a dormir',
    long: 'Te juro que si alguien vuelve a mencionar el examen de mañana voy a tirar el portátil por la ventana. '.repeat(12),
    accents: '¿Qué pasó, señor Muñoz? São Paulo é incrível, não é? Ñandú, acción.',
    emojis: 'jajaja 😂 <:pepe:423456789012345678> 🔥🔥🔥',
    word: 'Supercalifragilisticexpialidocious'.repeat(6),
  };
  for (const [name, sample] of Object.entries(samples)) {
    const samplePieces = quotePieces(sample);
    const emojis = new Map(samplePieces.filter((piece) => piece.type === 'emoji').slice(0, 2).map((piece) => [piece.key, fakeEmoji]));
    for (const look of [{}, { light: true }, { color: true, bold: true }]) {
      const buffer = await renderQuote({ pieces: samplePieces, emojis, avatar, displayName: 'Julián', username: 'liam', ...look });
      assert.ok(isPng(buffer), `${name} is a PNG`);
      assert.deepEqual(imageDimensions(buffer), { type: 'png', width: QUOTE_SIZE.width, height: QUOTE_SIZE.height }, `${name} has the size of a quote`);
    }
  }
  const noAvatar = await renderQuote({ pieces: quotePieces('sin avatar'), avatar: null, displayName: '', username: 'x' });
  assert.ok(isPng(noAvatar), 'a quote draws without an avatar');

  // Every effect, on a wide picture, and the big one is fitted inside the largest side.
  const input = await loadImage(await testImage(640, 400).encode('png'));
  const expected = {
    invert: [640, 400, 'png'], grayscale: [640, 400, 'png'], sepia: [640, 400, 'png'], blur: [640, 400, 'png'], pixelate: [640, 400, 'png'],
    rotate: [400, 640, 'png'], flip: [640, 400, 'png'], mirror: [640, 400, 'png'], circle: [400, 400, 'png'], deepfry: [640, 400, 'jpeg'], compress: [640, 400, 'jpeg'],
  };
  assert.deepEqual(Object.keys(expected).sort(), [...EFFECT_NAMES].sort(), 'every effect is checked');
  for (const name of EFFECT_NAMES) {
    const result = await applyEffect(name, input);
    const [width, height, format] = expected[name];
    assert.equal(result.format, format, `${name} is a ${format}`);
    assert.ok(format === 'png' ? isPng(result.buffer) : isJpeg(result.buffer), `${name} really is a ${format}`);
    assert.deepEqual([result.width, result.height], [width, height], `${name} is ${width}x${height}`);
    const decoded = await loadImage(result.buffer);
    assert.deepEqual([decoded.width, decoded.height], [width, height], `${name} decodes at its size`);
  }
  const inverted = await loadImage((await applyEffect('invert', input)).buffer);
  const probe = createCanvas(1, 1).getContext('2d');
  probe.drawImage(inverted, 160, 100, 1, 1, 0, 0, 1, 1);
  const [r, g] = probe.getImageData(0, 0, 1, 1).data;
  assert.ok(r < 60 && g > 180, 'invert turns the red square cyan');
  assert.deepEqual([(await applyEffect('rotate', input, 180)).width, (await applyEffect('rotate', input, 45)).width], [640, 735]);
  assert.equal(effectAmount('blur', 999), 50);
  assert.equal(effectAmount('compress', 'x'), 5);
  assert.equal(effectAmount('invert', 3), null);
  assert.deepEqual(fitSize(4096, 1024), { width: MAX_SIDE, height: 512 });
  const big = await applyEffect('grayscale', testImage(3000, 1500));
  assert.deepEqual([big.width, big.height], [2048, 1024], 'a large picture is fitted inside 2048 pixels');
  const jpegSmall = await applyEffect('compress', input, 1);
  const jpegLarge = await applyEffect('compress', input, 100);
  assert.ok(jpegSmall.buffer.length < jpegLarge.buffer.length, 'a lower quality is a smaller file');

  // The color of a picture.
  const red = createCanvas(64, 64);
  red.getContext('2d').fillStyle = '#e03030';
  red.getContext('2d').fillRect(0, 0, 64, 64);
  assert.equal(mainColor(red), 0xe03030);
  const gray = createCanvas(8, 8);
  gray.getContext('2d').fillStyle = '#000000';
  gray.getContext('2d').fillRect(0, 0, 8, 8);
  assert.equal(mainColor(gray), 0, 'a black picture is black, not nothing');
  assert.deepEqual(imageDimensions(await renderSwatch(red, 0xe03030)), { type: 'png', width: 900, height: 360 });

  // The size of a picture from its first bytes, before it is decoded.
  assert.deepEqual(imageDimensions(await testImage(33, 21).encode('jpeg')), { type: 'jpeg', width: 33, height: 21 });
  assert.deepEqual(imageDimensions(await testImage(33, 21).encode('webp')), { type: 'webp', width: 33, height: 21 });
  const gif = Buffer.from('R0lGODlhAgACAIABAP8AAP///yH5BAEAAAEALAAAAAACAAIAAAICjF8AOw==', 'base64');
  assert.deepEqual(imageDimensions(gif), { type: 'gif', width: 2, height: 2 });
  assert.equal(imageDimensions(Buffer.from('not an image at all')), null);

  // Loading: the first frame of a GIF, too many pixels refused before decoding, a download error told plainly.
  const fetchOf = (buffer) => async () => buffer;
  const loadedGif = await loadInputImage('https://x/a.gif', { fetch: fetchOf(gif) });
  assert.equal(loadedGif.gif, true);
  assert.equal(loadedGif.image.width, 2);
  const huge = Buffer.alloc(32);
  huge.writeUInt32BE(0x89504e47, 0);
  huge.writeUInt32BE(20000, 16);
  huge.writeUInt32BE(20000, 20);
  await assert.rejects(loadInputImage('https://x/huge.png', { fetch: fetchOf(huge) }), (err) => err.key === 'images.error.tooManyPixels');
  await assert.rejects(loadInputImage('https://x/a', { fetch: async () => { throw new Error('That image is too large.'); } }), (err) => err.key === 'images.error.tooLarge' && err.vars.mb === 8);
  await assert.rejects(loadInputImage('https://x/a', { fetch: async () => { throw new Error('That link is not a PNG, JPEG, WebP or GIF image.'); } }), (err) => err.key === 'images.error.notImage');
  await assert.rejects(loadInputImage('https://x/a', { fetch: fetchOf(Buffer.from('<html>nope</html> and more bytes')) }), (err) => err.key === 'images.error.notImage');
  assert.equal(INPUT_LIMITS.bytes, 8 * 1024 * 1024);

  // Where the picture comes from, in order.
  const user = (id) => ({ id, username: `u${id}`, displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}.png` });
  const author = user('111111111111111111');
  const other = user('222222222222222222');
  const files = (list) => new Map(list.map((file, i) => [String(i), file]));
  const client = { users: { fetch: async (id) => (id === other.id ? other : Promise.reject(new Error('unknown'))) } };
  const guild = { members: { cache: new Map(), fetch: async () => new Map() } };
  const message = (attachments = []) => ({ client, guild, author, attachments: files(attachments), stickers: new Map() });
  const png = { contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/own.png', size: 1000, name: 'own.png' };
  const replied = { author: other, attachments: files([{ contentType: 'image/jpeg', url: 'https://cdn.discordapp.com/attachments/reply.jpg', size: 10, name: 'reply.jpg' }]), embeds: [], stickers: new Map() };
  assert.equal((await findImageSource({ message: message([png]), replied, text: 'https://example.com/a.png' })).source, 'attachment');
  assert.equal((await findImageSource({ message: message(), replied, text: 'https://example.com/a.png' })).source, 'reply');
  const embedReply = { author: other, attachments: new Map(), embeds: [{ image: { url: 'https://example.com/e.png' } }], stickers: new Map() };
  assert.equal((await findImageSource({ message: message(), replied: embedReply })).url, 'https://example.com/e.png', 'an embed image of the replied message');
  assert.equal((await findImageSource({ message: message(), text: '<https://example.com/a.png>' })).url, 'https://example.com/a.png');
  await assert.rejects(findImageSource({ message: message(), text: 'http://example.com/a.png' }), (err) => err.key === 'images.error.httpsOnly');
  assert.deepEqual(await findImageSource({ message: message(), text: `<@${other.id}>` }).then((found) => [found.source, found.url]), ['member', `https://cdn.discordapp.com/avatars/${other.id}.png`]);
  await assert.rejects(findImageSource({ message: message(), text: 'nobody-here' }), (err) => err.key === 'images.error.noSource');
  const noImageReply = { author: other, attachments: new Map(), embeds: [], stickers: new Map() };
  assert.equal((await findImageSource({ message: message(), replied: noImageReply })).source, 'replyAuthor');
  assert.equal((await findImageSource({ message: message() })).source, 'self');
  await assert.rejects(findImageSource({ message: message([{ ...png, size: 9 * 1024 * 1024 }]) }), (err) => err.key === 'images.error.tooLarge');
  assert.equal(imageOfMessage({ attachments: files([{ contentType: 'text/plain', url: 'https://x/a.txt', name: 'a.txt' }]), embeds: [], stickers: new Map() }), null, 'a text file is not a picture');

  // The options typed after the command.
  assert.deepEqual(image.readArgs('rotate')('45 <@222222222222222222>'), { degrees: 45, source: '<@222222222222222222>' });
  assert.deepEqual(image.readArgs('rotate')('222222222222222222'), { source: '222222222222222222' }, 'a long number is an ID, not degrees');
  assert.deepEqual(image.readArgs('blur')(''), {});
  assert.deepEqual(image.readArgs('invert')('12 x'), { source: '12 x' }, 'an effect without a number keeps it in the source');
  assert.deepEqual(image.readArgs('compress')('10% https://example.com/a.png'), { quality: 10, source: 'https://example.com/a.png' });
  assert.deepEqual(Object.keys(image.prefixRawOptions).sort(), image.SUBCOMMANDS.map((sub) => sub.name).sort());
  assert.deepEqual(quote.readFlags('hola --light mundo --color --BOLD'), { flags: { color: true, light: true, bold: true }, rest: 'hola  mundo' });
  assert.deepEqual(quote.splitMember('<@222222222222222222> hola que tal'), { token: '<@222222222222222222>', words: 'hola que tal' });
  assert.deepEqual(quote.splitMember('hola que tal 222222222222222222'), { token: '222222222222222222', words: 'hola que tal' });
  assert.equal(quote.splitMember('hola'), null);

  // The shortcuts reach a real subcommand, and every command here stays a prefix command.
  const subs = new Set(image.SUBCOMMANDS.map((sub) => sub.name));
  const routes = DEFAULT_PREFIX_ROUTES.filter((route) => route.command === 'image');
  assert.ok(routes.length >= 12);
  for (const route of routes) assert.ok(subs.has(route.subcommand) && route.args[0] === route.subcommand, `!${route.alias} goes to an effect`);
  for (const command of [image, quote]) assert.ok(!command.registerSlash && !command.slashOnly, `${command.data.name} is not a slash command`);
  assert.ok(image.cooldownMs >= 3000 && quote.cooldownMs >= 3000, 'image commands have a cooldown');

  // Attach Files: the bot first, then the member.
  const channelWith = (botCan, memberCan) => ({ permissionsFor: (who) => ({ has: () => (who === 'me' ? botCan : memberCan) }) });
  const ask = (botCan, memberCan) => attachFilesProblem({ channel: channelWith(botCan, memberCan), guild: { members: { me: 'me' } }, member: 'member' }, 'en');
  assert.equal(ask(true, true), null);
  assert.match(ask(false, true), /I need the Attach Files/);
  assert.match(ask(true, false), /You need the Attach Files/);

  // At most two pictures are drawn at once.
  let active = 0;
  let peak = 0;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await Promise.all(Array.from({ length: 6 }, () => withRenderSlot(async () => { active += 1; peak = Math.max(peak, active); await sleep(5); active -= 1; })));
  assert.equal(peak, 2);
  const flood = Array.from({ length: 12 }, () => withRenderSlot(() => sleep(5)).then(() => 'ok', (err) => err.key));
  assert.ok((await Promise.all(flood)).includes('images.error.busy'), 'too many waiting are told to try again');

  console.log(`Image commands OK: quote in 5 texts x 3 looks, ${EFFECT_NAMES.length} effects and the color of a picture.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
