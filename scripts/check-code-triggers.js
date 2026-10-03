// Checks the commands that start on something other than the prefix of Petto: their own prefix, the start of a message, a
// whole message or words inside, and the command that sets them.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const store = new Map();
let listCalls = 0;
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: false }), getGuildLimits: () => ({ customCommands: 50 }) });
const settings = { ownerId: 'owner', developerIds: [], codeCommandsDisabled: false };
stub('src/config.js', settings);
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/handlers/prefixInteraction.js', { tokenize: (text) => String(text).match(/"[^"]*"|\S+/g)?.map((word) => word.replace(/^"|"$/g, '')) ?? [] });
stub('src/db/commandData.js', { forGuild: () => ({}) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/embedTemplates.js', { getTemplate: async () => null });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO' } });
stub('src/utils/colors.js', { COLORS: { DEFAULT: 1, RED: 2, GREEN: 3 } });
stub('src/db/customCommands.js', {
  normalizeName: (name) => name.toLowerCase().trim().replace(/\s+/g, ''),
  getCommand: async (guildId, name) => store.get(`${guildId}:${name}`) ?? null,
  upsertCommand: async (guildId, name, values) => { store.set(`${guildId}:${name}`, { name, trigger_type: 'command', trigger_text: null, ...values }); return store.get(`${guildId}:${name}`); },
  removeCommand: async (guildId, name) => store.delete(`${guildId}:${name}`),
  listCommands: async (guildId) => [...store.entries()].filter(([key]) => key.startsWith(`${guildId}:`)).map(([, value]) => value),
  listTriggers: async (guildId) => { listCalls += 1; return [...store.entries()].filter(([key, value]) => key.startsWith(`${guildId}:`) && value.trigger_type !== 'command').map(([, value]) => value); },
  setTrigger: async (guildId, name, type, text) => { const row = store.get(`${guildId}:${name}`); if (!row) return false; row.trigger_type = type; row.trigger_text = text; return true; },
});
const triggers = require('../src/utils/codeTriggers');
const command = require('../src/commands/automation/customcommand');

const row = (type, text, name = 'hello') => ({ name, trigger_type: type, trigger_text: text });
const match = (r, content) => triggers.matchTrigger(r, content);

// Its own prefix.
assert.deepEqual(match(row('prefix', '?'), '?hello'), { args: '', prefix: '?' });
assert.deepEqual(match(row('prefix', '?'), '?HELLO big world'), { args: 'big world', prefix: '?' }, 'the case does not matter and the rest is the arguments');
assert.equal(match(row('prefix', '?'), '?hellos'), null, 'the name must end where the word ends');
assert.equal(match(row('prefix', '?'), '!hello'), null); assert.equal(match(row('prefix', '?'), 'hello'), null);
assert.deepEqual(match(row('prefix', '>>'), '>>hello now'), { args: 'now', prefix: '>>' });
// The start of a message.
assert.deepEqual(match(row('startswith', 'hey bot'), 'Hey bot, how are you?'), { args: ', how are you?', prefix: '' });
assert.equal(match(row('startswith', 'hey'), 'heyyy there'), null, 'a word is not cut in the middle');
assert.deepEqual(match(row('startswith', 'hey'), 'hey'), { args: '', prefix: '' });
assert.deepEqual(match(row('startswith', '!!'), '!!now'), { args: 'now', prefix: '' }, 'a trigger that ends in a symbol needs no space after it');
assert.equal(match(row('startswith', 'hey'), 'oh hey'), null);
// A whole message.
assert.deepEqual(match(row('exact', 'good morning'), 'Good Morning'), { args: '', prefix: '' });
assert.equal(match(row('exact', 'good morning'), 'good morning everyone'), null);
assert.deepEqual(match(row('exact', 'good morning'), ' good morning '), { args: '', prefix: '' }, 'spaces around the message are ignored');
// Words inside.
assert.ok(match(row('contains', 'pizza'), 'I love pizza so much'));
assert.deepEqual(match(row('contains', 'pizza'), 'I love Pizza!'), { args: 'I love Pizza!', prefix: '' }, 'the arguments are the whole message');
assert.equal(match(row('contains', 'pizza'), 'pizzas are good'), null, 'a word inside another word does not count');
assert.equal(match(row('contains', 'pizza'), 'unpizza'), null);
assert.ok(match(row('contains', 'pizza'), 'pizzapizza pizza'), 'a later one counts');
assert.ok(match(row('contains', ':)'), 'hi :) there'), 'a symbol can be found anywhere');
// Nothing to match.
for (const r of [row('command', null), row('exact', ''), row('contains', ''), row('startswith', ''), row('nope', 'x')]) assert.equal(match(r, 'anything'), null);
assert.equal(match(row('exact', 'x'), ''), null);

// Checking what a person writes.
assert.deepEqual(triggers.validateTrigger('command', ''), { text: null });
assert.equal(triggers.validateTrigger('prefix', '?').text, '?');
for (const [type, text, message] of [['nope', 'x', 'one of'], ['exact', '', 'Write the text'], ['exact', 'x'.repeat(51), 'at most 50'], ['prefix', 'a b', 'no spaces'], ['prefix', '??????', 'at most 5'], ['contains', '@everyone', 'mention'], ['contains', '<@123>', 'mention']]) {
  const result = triggers.validateTrigger(type, text);
  assert.ok(result.error && result.error.includes(message), `${type} ${text}: ${JSON.stringify(result)}`);
}

(async () => {
  const guild = 'G1';
  store.set(`${guild}:hello`, { name: 'hello', code: 'hi', trigger_type: 'prefix', trigger_text: '?' });
  store.set(`${guild}:pizza`, { name: 'pizza', code: 'yum', trigger_type: 'contains', trigger_text: 'pizza' });
  store.set(`${guild}:plain`, { name: 'plain', response: 'x', trigger_type: 'command', trigger_text: null });
  assert.equal((await triggers.findTrigger(guild, '?hello world')).row.name, 'hello');
  assert.equal((await triggers.findTrigger(guild, 'I want pizza')).row.name, 'pizza');
  assert.equal(await triggers.findTrigger(guild, 'nothing here'), null);
  assert.equal(await triggers.findTrigger(guild, '!plain'), null, 'a command that starts with the prefix of Petto is not a trigger');
  assert.equal((await triggers.findTrigger('G2', 'pizza')), null, 'another server has none');
  const before = listCalls;
  for (let i = 0; i < 20; i += 1) await triggers.findTrigger(guild, 'x');
  assert.equal(listCalls, before, 'the commands of a server are kept, a message does not read the database');
  triggers.invalidateTriggers(guild);
  await triggers.findTrigger(guild, 'x');
  assert.equal(listCalls, before + 1, 'and are read again after a change');

  // The command that sets it.
  const run = async (options, content, user = 'tester') => {
    const out = [];
    const interaction = {
      guild: { id: guild }, user: { id: user }, rawMessage: { content }, client: { commands: new Map([['ping', {}]]), commandAliases: new Map() },
      options: { getSubcommand: () => 'trigger', getString: (name, required) => { const value = options[name] ?? null; if (required && value === null) throw new Error(`missing ${name}`); return value; } },
      deferReply: async () => {}, editReply: async (payload) => { out.push(payload.components[0].text); },
    };
    await command.execute(interaction);
    return out.join('\n');
  };
  settings.codeCommandsDisabled = true;
  assert.ok((await run({ name: 'plain' }, '!cc trigger plain', 'someone')).includes('turned off'));
  settings.codeCommandsDisabled = false;
  assert.ok((await run({ name: 'plain' }, '!cc trigger plain')).includes('the prefix of Petto'));
  assert.ok((await run({ name: 'nope' }, '!cc trigger nope')).includes('does not exist'));
  assert.ok((await run({ name: 'plain', type: 'prefix', text: '?' }, '!cc trigger plain prefix ?')).includes('its own prefix: `?plain`'));
  assert.equal(store.get(`${guild}:plain`).trigger_type, 'prefix');
  assert.ok((await run({ name: 'plain' }, '!cc trigger plain')).includes('`?plain`'), 'it says how the command starts');
  assert.ok((await run({ name: 'plain', type: 'startswith', text: 'hey' }, '!cc trigger plain startswith hey there friend')).includes('startswith: `hey there friend`'), 'the words of a trigger keep their spaces');
  assert.equal(store.get(`${guild}:plain`).trigger_text, 'hey there friend');
  assert.equal((await triggers.findTrigger(guild, 'hey there friend, hi')).row.name, 'plain', 'the change is seen at once');
  assert.ok((await run({ name: 'plain', type: 'command' }, '!cc trigger plain command')).includes('the prefix of Petto again'));
  assert.equal(store.get(`${guild}:plain`).trigger_type, 'command');
  assert.ok((await run({ name: 'plain', type: 'prefix', text: 'a b' }, '!cc trigger plain prefix a b')).includes('no spaces'));
  assert.ok((await run({ name: 'plain', type: 'prefix', text: 'p' }, '!cc trigger plain prefix p')).includes('now starts with'));
  // A real command cannot be taken over by a prefix and a name.
  store.set(`${guild}:ing`, { name: 'ing', code: 'x', trigger_type: 'command', trigger_text: null });
  assert.ok((await run({ name: 'ing', type: 'prefix', text: 'p' }, '!cc trigger ing prefix p')).includes('real command'), 'p + ing is ping');
  // At most 25 with a trigger.
  for (let i = 0; i < 25; i += 1) store.set(`${guild}:t${i}`, { name: `t${i}`, code: 'x', trigger_type: 'exact', trigger_text: `t${i}` });
  triggers.invalidateTriggers(guild);
  store.set(`${guild}:extra`, { name: 'extra', code: 'x', trigger_type: 'command', trigger_text: null });
  assert.ok((await run({ name: 'extra', type: 'exact', text: 'extra' }, '!cc trigger extra exact extra')).includes('the most it can'));
  console.log('Checked the triggers of custom commands: their own prefix, starts, whole messages, words inside and the command that sets them.');
})().catch((error) => { console.error(error); process.exit(1); });
