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
  const replied = [];
  const channel = { id: 'c1', send: async (payload) => { sent.push(payload); return { id: 'm', edit: async () => {} }; } };
  const message = { guild: { id: 'g' }, channel, channelId: 'c1', member: {}, author: {}, client: { channels: { cache: new Map() } }, reply: async (payload) => { replied.push(payload); return { id: 'r', edit: async () => {} }; } };
  const interaction = buildPseudoInteraction(message, { commandName: 'nuke', subcommand: null, subcommandGroup: null, values: {} });
  await interaction.deferReply();
  await interaction.editReply('still here');
  assert.equal(replied.length, 1, 'with the channel there, it answers as a reply to the message that typed the command');
  assert.equal(sent.length, 0, 'and not as a loose message of the channel');
  const gone = { ...message, channel: null, channelId: 'c1' };
  const after = buildPseudoInteraction({ ...message }, { commandName: 'nuke', subcommand: null, subcommandGroup: null, values: {} });
  Object.assign(after.rawMessage, { channel: null });
  assert.equal(await after.editReply('nobody to tell'), null, 'without the channel it does not throw');
  assert.equal(await after.followUp('nobody to tell'), null);
  void gone;
  console.log('prefix reply without channel ok');

  // Every answer of a prefix command is a reply to the message that typed it: the first answer (reply, or editReply after deferReply) and the
  // follow ups; when that message is gone (Discord refuses the reference) the answer goes to the channel instead of being lost.
  {
    const log = [];
    const chan = { id: 'c2', send: async (payload) => { log.push(['send', payload]); return { id: 's', edit: async () => {} }; } };
    const msg = { guild: { id: 'g' }, channel: chan, channelId: 'c2', member: {}, author: {}, client: { channels: { cache: new Map() } }, reply: async (payload) => { log.push(['reply', payload]); return { id: 'r', edit: async (next) => { log.push(['edit', next]); } }; } };
    const make = () => buildPseudoInteraction(msg, { commandName: 'ping', subcommand: null, subcommandGroup: null, values: {} });
    let i = make();
    await i.reply('one');
    await i.followUp('two');
    assert.deepEqual(log.map(([kind]) => kind), ['reply', 'reply'], 'reply and followUp both reply to the message');
    log.length = 0;
    i = make();
    await i.deferReply();
    await i.editReply('after a defer');
    await i.editReply('changed');
    assert.deepEqual(log.map(([kind]) => kind), ['reply', 'edit'], 'the first editReply after deferReply is a reply to the message and the next one edits that answer');
    log.length = 0;
    // The message was deleted: Discord answers 10008 (or 50035 for the reference); the answer goes to the channel.
    for (const error of [Object.assign(new Error('Unknown Message'), { code: 10008 }), Object.assign(new Error('Invalid Form Body message_reference: Unknown message'), { code: 50035 })]) {
      log.length = 0;
      const gone = { ...msg, reply: async () => { throw error; } };
      const j = buildPseudoInteraction(gone, { commandName: 'ping', subcommand: null, subcommandGroup: null, values: {} });
      await j.reply('still here');
      assert.deepEqual(log.map(([kind]) => kind), ['send'], `a deleted message (${error.code}) still gets its answer in the channel`);
    }
    // Another error is not hidden.
    const broken = { ...msg, reply: async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); } };
    await assert.rejects(() => buildPseudoInteraction(broken, { commandName: 'ping', subcommand: null, subcommandGroup: null, values: {} }).reply('x'), /Missing Permissions/);
  }
  console.log('prefix answers reply to the message ok');
})().catch((error) => { console.error(error); process.exit(1); });
