// Answering by quoting: without Read Message History, or when the quoted message is gone, it falls back to a normal message.
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { installSafeReply, isReferenceProblem, withoutQuote } = require('../src/utils/safeReply');
const { isPermissionError, permissionHelp } = require('../src/utils/permissionErrors');
const { isRoutineNoise } = require('../src/utils/discordErrorLog');

assert.equal(isReferenceProblem({ code: 160002 }), true);
assert.equal(isReferenceProblem({ code: 10008 }), true);
assert.equal(isReferenceProblem({ code: 50035, rawError: { errors: { message_reference: {} } } }), true);
assert.equal(isReferenceProblem({ code: 50035, rawError: { errors: { content: {} } } }), false);
assert.equal(isReferenceProblem({ code: 50013 }), false);
assert.deepEqual(withoutQuote('hi'), { content: 'hi' });
assert.deepEqual(withoutQuote({ content: 'x', failIfNotExists: false, reply: { messageReference: '1' } }), { content: 'x' });

assert.equal(isPermissionError({ code: 160002 }), true);
assert.equal(isPermissionError({ code: 50013 }), true);
assert.equal(isPermissionError({ code: 10062 }), false);
assert.match(permissionHelp({ code: 160002 }), /Read Message History/);
assert.equal(isRoutineNoise('warn', ['Missing permission running !serverinfo: Cannot reply without permission to read message history (code 160002)']), true);
assert.equal(isRoutineNoise('error', ['Missing Permissions']), false, 'an error is always sent');

(async () => {
  const sent = [];
  let failWith = null;
  class FakeMessage {
    constructor(channel, guild) { this.channel = channel; this.guild = guild; }
    async reply(options) { if (failWith) throw failWith; sent.push({ via: 'reply', options }); return { id: 'r' }; }
  }
  installSafeReply(FakeMessage);
  installSafeReply(FakeMessage);
  const channelOf = (allowed) => ({
    send: async (options) => { sent.push({ via: 'send', options }); return { id: 's' }; },
    permissionsFor: () => ({ has: (flag) => (flag === PermissionFlagsBits.ReadMessageHistory ? allowed : true) }),
  });
  const guild = { members: { me: {} } };

  await new FakeMessage(channelOf(true), guild).reply({ content: 'a' });
  assert.equal(sent.pop().via, 'reply', 'with the permission it quotes');

  await new FakeMessage(channelOf(false), guild).reply({ content: 'b', failIfNotExists: false });
  const plain = sent.pop();
  assert.equal(plain.via, 'send', 'without Read Message History it is a normal message');
  assert.deepEqual(plain.options, { content: 'b' });

  failWith = Object.assign(new Error('Cannot reply without permission to read message history'), { code: 160002 });
  await new FakeMessage(channelOf(true), guild).reply('c');
  assert.deepEqual(sent.pop(), { via: 'send', options: { content: 'c' } }, 'a refusal of Discord falls back too');

  failWith = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  await assert.rejects(() => new FakeMessage(channelOf(true), guild).reply('d'), /Missing Permissions/, 'other errors are not hidden');

  console.log('safe reply ok');
})().catch((error) => { console.error(error); process.exit(1); });
