// Checks `!jumbo` (an emoji or a sticker shown big, with a button to steal it) and the button: what it shows for a custom emoji, a moving one, an
// ordinary one, a sticker, a Lottie sticker and nothing; that the button is only there when this server lacks it; and who may press it.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, MessageFlags, PermissionFlagsBits, StickerFormatType } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const jumbo = require('../src/commands/utility/jumbo');
const button = require('../src/interactions/jumbo');
const { unicodeEmojiIn, unicodeEmojiUrl, emojisOfMessage } = require('../src/utils/expressions');

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
  assert.match(plain(out), /already has it/, 'and the card says why');
  assert.doesNotMatch(plain(await run({ typed: '<:wave:111>' })), /already has it/, 'but only when it does');
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

  // The button: needs the permission in the person and in the bot, locks itself at once, adds the emoji or the sticker, says Stolen, and
  // every edit of the message says it is a Components V2 one (Discord refuses the edit otherwise).
  const V2 = MessageFlags.IsComponentsV2;
  const press = async (customId, { member = true, g = guild(), failWith = null } = {}) => {
    const log = { updates: [], edits: [], follows: [], replies: [] };
    const card = { type: 17, components: [{ type: 10, content: 'x' }, { type: 1, components: [{ type: 2, custom_id: customId, label: 'Steal', disabled: false }, { type: 2, style: 5, url: 'https://x', label: 'Open' }] }] };
    if (failWith) g.emojis.create = async () => { throw new Error(failWith); };
    await button.handleButton({
      customId, guild: g, client: { fetchSticker: async (id) => ({ id, name: 'hello', tags: 'wave', description: 'hi', format: StickerFormatType.PNG }) },
      member: { permissions: { has: () => member } }, message: { components: [{ toJSON: () => card }] },
      update: async (payload) => log.updates.push(payload), editReply: async (payload) => log.edits.push(payload), followUp: async (payload) => log.follows.push(payload),
      reply: async (payload) => log.replies.push(payload), deferReply: async () => {},
    });
    log.text = plain([log.replies, log.follows]);
    return log;
  };
  const buttonOf = (payload) => payload.components[0].components[1].components[0];
  let log = await press('jumbo:e:111:s:wave', { member: false });
  assert.match(log.text, /need the/); assert.equal(guild.made, undefined, 'nothing was added without the permission'); assert.equal(log.updates.length, 0);
  log = await press('jumbo:e:111:s:wave');
  assert.equal(log.updates.length, 1, 'the button is locked at once'); assert.equal(buttonOf(log.updates[0]).disabled, true); assert.match(buttonOf(log.updates[0]).label, /Adding/);
  assert.equal(log.updates[0].flags & V2, V2, 'the update says it is a V2 message'); assert.equal(log.edits[0].flags & V2, V2, 'so does the edit');
  assert.equal(buttonOf(log.edits[0]).disabled, true); assert.equal(buttonOf(log.edits[0]).label, 'Stolen');
  assert.match(log.text, /added as/); assert.equal(log.follows[0].flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral, 'the answer is private');
  assert.equal(guild.made.name, 'wave'); assert.ok(guild.made.attachment.endsWith('/111.png?size=512'));
  log = await press('jumbo:e:222:a:dance'); assert.match(log.text, /added as/); assert.ok(guild.made.attachment.includes('222.gif'));
  log = await press('jumbo:s:555'); assert.match(log.text, /Sticker \*\*hello\*\* added/); assert.equal(guild.made.name, 'hello'); assert.equal(guild.made.tags, 'wave');
  assert.match((await press('jumbo:e:111:s:wave', { g: guild({ emojis: { 111: {} } }) })).text, /already in this server/);
  // When it fails, the button is free again and the answer says why.
  log = await press('jumbo:e:333:s:fail', { failWith: 'Maximum number of emojis reached' });
  assert.match(log.text, /Maximum number of emojis reached/); assert.equal(buttonOf(log.edits[0]).disabled, false, 'a failed steal can be tried again');
  // Two presses at once: the second one is told to wait, and only one emoji is made.
  let made = 0; const slow = guild(); slow.emojis.create = async () => { made += 1; await new Promise((r) => setTimeout(r, 30)); return { name: 'n', toString: () => '<:n:1>' }; };
  const [first, second] = await Promise.all([press('jumbo:e:444:s:n', { g: slow }), press('jumbo:e:444:s:n', { g: slow })]);
  assert.equal(made, 1, 'only one is added'); assert.match(first.text + second.text, /already adding/);

  // The emojis of a card (Components V2) and of its buttons are found too: the text of a text display, a section with a button, a row of buttons, a menu.
  const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
  const cardMessage = message({
    components: [new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('hello <:one:111> and <a:two:222>'))
      .addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('<:three:333>')).setButtonAccessory(new ButtonBuilder().setCustomId('x').setStyle(ButtonStyle.Secondary).setEmoji({ id: '444', name: 'four' })))
      .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('y').setStyle(ButtonStyle.Primary).setEmoji({ id: '555', name: 'five', animated: true }).setLabel('Five'), new ButtonBuilder().setCustomId('z').setStyle(ButtonStyle.Secondary).setEmoji('👋')))
      .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('m').addOptions({ label: 'Opt', value: 'o', emoji: { id: '666', name: 'six' } })))],
  });
  const found = emojisOfMessage(cardMessage);
  assert.deepEqual(found.map((entry) => entry.id).sort(), ['111', '222', '333', '444', '555', '666'], 'the emojis of the text, the section button, the row and the menu are found');
  assert.equal(found.find((entry) => entry.id === '222').animated, true);
  assert.equal(found.find((entry) => entry.id === '555').animated, true);
  assert.deepEqual(emojisOfMessage(message({ components: [] })), [], 'a message with no cards has none');
  assert.deepEqual(emojisOfMessage(message()), [], 'and a message without components at all');

  console.log('Checked !jumbo and its steal button.');
})().catch((err) => { console.error(err); process.exit(1); });
