// `!prefix ?` and `!prefix set ?` both set the prefix `?`; a prefix with a space, an @ or a backtick is refused, and so is one over 12 characters.
const assert = require('node:assert/strict');
const { readPrefixInput, isValidPrefix } = require('../src/utils/prefixInput');

assert.equal(readPrefixInput('?'), '?');
assert.equal(readPrefixInput('set ?'), '?');
assert.equal(readPrefixInput('SET  ?'), '?');
assert.equal(readPrefixInput('  ,  '), ',');
assert.equal(readPrefixInput('settle'), 'settle', 'a prefix that starts with the letters set is not cut');
assert.equal(readPrefixInput('set'), 'set', 'only the word set is the prefix set');
assert.equal(isValidPrefix('?'), true);
assert.equal(isValidPrefix('set ?'), false);
assert.equal(isValidPrefix('abcdef'), true, 'a prefix can have up to 12 characters');
assert.equal(isValidPrefix('abcdefghijklm'), false, '13 characters are too many');
assert.equal(isValidPrefix('a@'), false);
assert.equal(isValidPrefix('a`'), false);
assert.equal(isValidPrefix(readPrefixInput('set a b')), false, 'a space inside is refused');
assert.equal(isValidPrefix(''), false);
console.log('prefix input ok');

// A command that deletes its own channel (nuke) leaves no channel to answer in: answering is skipped, not an error.
(async () => {
  const { buildPseudoInteraction } = require('../src/handlers/prefixInteraction');
  const sent = [];
  const channel = { id: 'c1', send: async (payload) => { sent.push(payload); return { id: 'm', edit: async () => {} }; } };
  const message = { guild: { id: 'g' }, channel, channelId: 'c1', member: {}, author: {}, client: { channels: { cache: new Map() } }, reply: async () => ({ id: 'r' }) };
  const interaction = buildPseudoInteraction(message, { commandName: 'nuke', subcommand: null, subcommandGroup: null, values: {} });
  await interaction.deferReply();
  await interaction.editReply('still here');
  assert.equal(sent.length, 1, 'with the channel there, it answers');
  const gone = { ...message, channel: null, channelId: 'c1' };
  const after = buildPseudoInteraction({ ...message }, { commandName: 'nuke', subcommand: null, subcommandGroup: null, values: {} });
  Object.assign(after.rawMessage, { channel: null });
  assert.equal(await after.editReply('nobody to tell'), null, 'without the channel it does not throw');
  assert.equal(await after.followUp('nobody to tell'), null);
  void gone;
  console.log('prefix reply without channel ok');
})().catch((error) => { console.error(error); process.exit(1); });
