// Checks how `!giveaway edit` reads its text: the prize needs no quotes, and the winners and the new end are taken from the end of the text.
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';

const command = require('../src/commands/giveaways/giveaway');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const read = command.prefixRawOptions.edit;
const ID = '1553084787030491138';

assert.deepEqual(read(`${ID} $10 NITRO / 1x DECO 1 30d`), { message_id: ID, prize: '$10 NITRO / 1x DECO', winners: 1, duration: '30d' }, 'the prize without quotes');
assert.deepEqual(read(`${ID} "$10 NITRO / 1x DECO" 1 30d`), { message_id: ID, prize: '$10 NITRO / 1x DECO', winners: 1, duration: '30d' }, 'the prize in quotes');
assert.deepEqual(read(`${ID} --prize "A prize 2" --winners 3 --duration 2h`), { message_id: ID, prize: 'A prize 2', winners: 3, duration: '2h' }, 'with flags, a number can end the prize');
assert.deepEqual(read(`${ID} Steam game 3d 4h`), { message_id: ID, prize: 'Steam game', duration: '3d 4h' }, 'a duration in two words');
assert.deepEqual(read(`${ID} 30d`), { message_id: ID, duration: '30d' }, 'only the new end');
assert.deepEqual(read(`${ID} Nitro`), { message_id: ID, prize: 'Nitro' });
assert.deepEqual(read(`${ID} 2`), { message_id: ID, prize: '2' }, 'a lone number is the prize');
assert.deepEqual(read(ID), { message_id: ID });

(async () => {
  // Through the whole prefix reader, as the bot receives the message.
  const message = { guild: { id: '1' }, channel: { id: '2' }, member: {}, author: { id: '3' }, client: {} };
  const interaction = await buildInteractionFromMessage(message, command, `edit ${ID} $10 NITRO / 1x DECO 1 30d`);
  assert.equal(interaction.options.getSubcommand(), 'edit');
  assert.equal(interaction.options.getString('message_id', true), ID);
  assert.equal(interaction.options.getString('prize'), '$10 NITRO / 1x DECO');
  assert.equal(interaction.options.getInteger('winners'), 1);
  assert.equal(interaction.options.getString('duration'), '30d');
  console.log('Checked the giveaway edit text: free prize, winners and end, flags, and the whole prefix reader.');
})().catch((err) => { console.error(err); process.exit(1); });
