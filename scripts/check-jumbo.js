// Checks `!jumbo` (an emoji or a sticker shown big, with a button to steal it) and the button: what it shows for a custom emoji, a moving one, an
// ordinary one, a sticker, a Lottie sticker and nothing; that the button is only there when this server lacks it; and who may press it.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, PermissionFlagsBits, StickerFormatType } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const jumbo = require('../src/commands/utility/jumbo');
const button = require('../src/interactions/jumbo');
const { unicodeEmojiIn, unicodeEmojiUrl } = require('../src/utils/expressions');

const guild = (have = {}) => ({
  emojis: { cache: new Map(Object.entries(have.emojis ?? {})), create: async ({ attachment, name }) => { guild.made = { attachment, name }; return { name, toString: () => `<:${name}:9>` }; } },
  stickers: { cache: new Map(Object.entries(have.stickers ?? {})), create: async (data) => { guild.made = data; return { name: data.name }; } },
  members: { me: { permissions: { has: (flag) => flag === PermissionFlagsBits.ManageGuildExpressions } } },
});
const plain = (value) => JSON.stringify(value);

async function run({ typed = null, replied = null, stickers = [], have = {}, noGuild = false }) {
  let sent = null;
  const rawMessage = { stickers: new Collection(stickers.map((s) => [s.id, s])), reference: replied ? { messageId: '1' } : null, fetchReference: async () => replied };
  await jumbo.execute({ guild: noGuild ? null : guild(have), rawMessage, options: { getString: () => typed }, reply: async (payload) => { sent = payload; } });
  return sent;
}
const buttonsOf = (payload) => payload.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((c) => c.components);
const message = (extra = {}) => ({ content: '', embeds: [], stickers: new Collection(), reactions: { cache: new Collection() }, ...extra });

(async () => {
  // A custom emoji: shown big (its picture is in the card), with the open link and the steal button.
  let out = await run({ typed: '<:wave:111>' });
  assert.match(plain(out), /emojis\/111\.png\?size=512/);
  assert.ok(buttonsOf(out).some((b) => b.style === 5 && b.url.includes('/111.png')), 'a link to the original');
  assert.ok(buttonsOf(out).some((b) => b.custom_id === 'jumbo:e:111:s:wave'), 'the steal button of a still emoji');
  // A moving one is a gif and says so.
  out = await run({ typed: '<a:dance:222>' });
  assert.match(plain(out), /222\.gif/); assert.match(plain(out), /moves/); assert.ok(buttonsOf(out).some((b) => b.custom_id === 'jumbo:e:222:a:dance'));
  // One this server already has: no steal button.
  out = await run({ typed: '<:wave:111>', have: { emojis: { 111: {} } } });
  assert.ok(!buttonsOf(out).some((b) => String(b.custom_id).startsWith('jumbo:')), 'nothing to steal when the server has it');
  // Several in the text: the first, and the others are counted.
  out = await run({ typed: '<:a:1> <:b:2> <:c:3>' });
  assert.match(plain(out), /2 more in that message/);
  // The replied message: its sticker, or its emojis.
  const sticker = { id: '555', name: 'hello', format: StickerFormatType.PNG };
  out = await run({ replied: message({ stickers: new Collection([['555', sticker]]) }) });
  assert.match(plain(out), /stickers\/555\.png/); assert.ok(buttonsOf(out).some((b) => b.custom_id === 'jumbo:s:555'));
  out = await run({ replied: message({ content: 'hi <:star:777>' }) });
  assert.match(plain(out), /emojis\/777\.png/);
  // A Lottie sticker has no picture.
  out = await run({ replied: message({ stickers: new Collection([['9', { id: '9', name: 'cat', format: StickerFormatType.Lottie }]]) }) });
  assert.match(plain(out), /Lottie/); assert.equal(buttonsOf(out).length, 0);
  // An ordinary emoji: big, with no steal.
  out = await run({ typed: 'look 😀' });
  assert.match(plain(out), /twemoji.*1f600\.png/); assert.ok(!buttonsOf(out).some((b) => String(b.custom_id).startsWith('jumbo:')));
  // In a direct message there is nothing to steal into.
  out = await run({ typed: '<:wave:111>', noGuild: true });
  assert.ok(!buttonsOf(out).some((b) => String(b.custom_id).startsWith('jumbo:')));
  // Nothing at all.
  assert.match(plain(await run({ typed: 'just words' })), /Write an emoji/);
  assert.match(plain(await run({})), /Write an emoji/);
  // The picture of an ordinary emoji: skin tones and joins keep their parts, the variation selector goes.
  assert.equal(unicodeEmojiUrl('❤️').split('/').pop(), '2764.png');
  assert.equal(unicodeEmojiUrl('👨‍👩‍👧').split('/').pop(), '1f468-200d-1f469-200d-1f467.png');
  assert.equal(unicodeEmojiIn('<:custom:1> 123 #'), null);

  // The button: needs the permission in the person and in the bot, and adds the emoji or the sticker.
  const press = async (customId, { member = true, g = guild() } = {}) => {
    const replies = [];
    await button.handleButton({
      customId, guild: g, client: { fetchSticker: async (id) => ({ id, name: 'hello', tags: 'wave', description: 'hi', format: StickerFormatType.PNG }) },
      member: { permissions: { has: () => member } },
      reply: async (payload) => replies.push(plain(payload)), deferReply: async () => {}, editReply: async (payload) => replies.push(plain(payload)),
    });
    return replies.join(' ');
  };
  assert.match(await press('jumbo:e:111:s:wave', { member: false }), /need the/);
  assert.equal(guild.made, undefined, 'nothing was added without the permission');
  assert.match(await press('jumbo:e:111:s:wave'), /added as/);
  assert.equal(guild.made.name, 'wave'); assert.ok(guild.made.attachment.endsWith('/111.png?size=512'));
  assert.match(await press('jumbo:e:222:a:dance'), /added as/); assert.ok(guild.made.attachment.includes('222.gif'));
  assert.match(await press('jumbo:s:555'), /Sticker \*\*hello\*\* added/); assert.equal(guild.made.name, 'hello'); assert.equal(guild.made.tags, 'wave');
  assert.match(await press('jumbo:e:111:s:wave', { g: guild({ emojis: { 111: {} } }) }), /already in this server/);

  console.log('Checked !jumbo and its steal button.');
})().catch((err) => { console.error(err); process.exit(1); });
