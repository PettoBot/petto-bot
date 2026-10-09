// Checks `!customcommand rename`: the same command under another name, and the cases that must not work.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';

function stub(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const rows = new Map([['req1', { name: 'req1', code: '{{ "hi" }}', trigger_type: 'prefix', trigger_text: '.' }], ['claim', { name: 'claim', code: '{{ "x" }}' }]]);
const normalizeName = (name) => name.toLowerCase().trim().replace(/\s+/g, '');
stub('src/db/database.js', { from: () => ({}) });
stub('src/db/guilds.js', { ensureGuild: async () => ({ prefix: 'p!' }) });
stub('src/db/customCommands.js', {
  normalizeName,
  getCommand: async (_guild, name) => rows.get(normalizeName(name)) ?? null,
  setTrigger: async (_guild, name, type, text) => { const row = rows.get(normalizeName(name)); if (!row) return false; row.trigger_type = type; row.trigger_text = text; return true; },
  listTriggers: async () => [...rows.values()].filter((row) => row.trigger_type && row.trigger_type !== 'command'),
  renameCommand: async (_guild, from, to) => { const row = rows.get(from); if (!row) return false; rows.delete(from); rows.set(to, { ...row, name: to }); return true; },
});

const command = require('../src/commands/automation/customcommand');
const sent = [];
function interaction(name, newName) {
  return {
    guild: { id: '1' },
    client: { commands: new Map([['ban', {}]]), commandAliases: new Map([['req', 'request']]) },
    options: { getSubcommand: () => 'rename', getString: (key) => (key === 'name' ? name : newName) },
    rawMessage: { content: '' },
    deferReply: async () => {},
    editReply: async (payload) => { sent.push(JSON.stringify(payload.components[0].toJSON())); },
  };
}
const last = () => sent[sent.length - 1];

(async () => {
  assert.equal(command.data.toJSON().options.some((option) => option.name === 'rename'), true);
  await command.execute(interaction('req1', 'req2'));
  assert.ok(rows.has('req2') && !rows.has('req1'), 'the command has the new name');
  assert.match(last(), /`req1` is now `req2`/);
  assert.match(last(), /p!req2/, 'it says the prefix of the server');
  assert.match(last(), /\.req2/, 'it says its own prefix with the new name');

  await command.execute(interaction('nope', 'other'));
  assert.match(last(), /does not exist/);
  await command.execute(interaction('req2', 'claim'));
  assert.match(last(), /already exists/);
  assert.ok(rows.has('req2'), 'nothing changed');
  await command.execute(interaction('req2', 'ban'));
  assert.match(last(), /already a real command/);
  await command.execute(interaction('req2', 'req'));
  assert.match(last(), /already a real command/, 'req is an alias of Petto');
  await command.execute(interaction('req2', 'two words!'));
  assert.match(last(), /1 to 32 letters/);
  await command.execute(interaction('req2', 'REQ2'));
  assert.match(last(), /already/);

  // The prefix of a command: the warning when the code says one the command does not have, and the answers of `trigger`
  const interactionFor = (sub, values) => ({ ...interaction('', ''), options: { getSubcommand: () => sub, getString: (key) => values[key] ?? null } });
  rows.set('req', { name: 'req', code: '{{/* req: .req <what you ask> */}}', trigger_type: 'command', trigger_text: null });
  const warn = await command.missingPrefixWarning(interactionFor('code', {}), 'req', '{{/* req: .req <what you ask> */}}\n{{ "x" }}', 'p!');
  assert.match(warn, /says it is used as `\.req`/);
  assert.match(warn, /p!customcommand trigger req prefix \./, 'it says the command that gives the prefix');
  assert.equal(await command.missingPrefixWarning(interactionFor('code', {}), 'req', '{{ "no comment" }}', 'p!'), '', 'no warning without a prefix in the code');
  rows.set('req3', { name: 'req3', code: '{{ 1 }}', trigger_type: 'command', trigger_text: null });
  const renamed = await command.missingPrefixWarning(interactionFor('code', {}), 'req3', '{{/* req: .req <what you ask> */}}', 'p!');
  assert.match(renamed, /rename req3 req/, 'when the code calls it by another name it says how to rename');

  await command.execute(interactionFor('trigger', { name: 'req', type: 'prefix' }));
  assert.match(last(), /Write the prefix after/, 'prefix without text explains how');
  await command.execute(interactionFor('trigger', { name: 'req', type: 'prefix', text: 'p!' }));
  assert.match(last(), /prefix of the server already/);
  await command.execute(interactionFor('trigger', { name: 'req', type: 'prefix', text: '.' }));
  assert.match(last(), /now starts with its own prefix: `\.req`/);
  assert.equal(await command.missingPrefixWarning(interactionFor('code', {}), 'req', '{{/* req: .req <what you ask> */}}', 'p!'), '', 'no warning once it has the prefix');
  await command.execute(interactionFor('trigger', { name: 'req', type: 'prefix', text: '.' }));
  assert.match(last(), /already starts with its own prefix/);
  await command.execute(interactionFor('trigger', { name: 'req', type: 'prefix', text: ',' }));
  assert.match(last(), /now starts with its own prefix: `,req`/);
  assert.match(last(), /It was its own prefix `\.`/, 'it says what it was');
  await command.execute(interactionFor('trigger', { name: 'req' }));
  assert.match(last(), /starts with its own prefix `,`/);
  await command.execute(interactionFor('trigger', { name: 'req', type: 'command' }));
  assert.match(last(), /prefix of the server again/);
  await command.execute(interactionFor('trigger', { name: 'req', type: 'command' }));
  assert.match(last(), /already starts with the prefix of the server/);
  console.log('Checked !customcommand rename and trigger.');
})().catch((err) => { console.error(err); process.exit(1); });
