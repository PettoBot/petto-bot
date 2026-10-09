// Checks `!reactionrole add new <emoji> <role> --embed <name>`: it posts a saved embed and puts the role button on that message,
// and it takes the message down when something fails.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';

function stub(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const bindings = [];
let failSave = false;
const synced = [];
let template = { content: 'Pick your role', embeds: [{ title: 'Roles' }], components: [] };
stub('src/db/database.js', { from: () => ({}) });
stub('src/db/guilds.js', { ensureGuild: async () => ({ prefix: '!' }) });
stub('src/db/reactionRoles.js', {
  getReactionRole: async (messageId, emoji) => bindings.find((row) => row.message_id === messageId && row.emoji === emoji) ?? null,
  addReactionRole: async (row) => { if (failSave) throw new Error('database down'); const saved = { id: bindings.length + 1, ...row }; bindings.push(saved); return saved; },
  removeReactionRoleById: async (id) => { const index = bindings.findIndex((row) => row.id === id); if (index >= 0) bindings.splice(index, 1); },
  listForMessage: async (messageId) => bindings.filter((row) => row.message_id === messageId),
});
stub('src/interactions/reactionRoleButton.js', { syncMessageButtons: async (message, rows) => { synced.push({ id: message.id, rows: rows.length }); } });
stub('src/utils/templatedMessage.js', { templatePayload: async (_guild, name) => (name === 'roles' ? template : null) });

const command = require('../src/commands/automation/reactionrole');
const replies = [];
const posted = [];
const deleted = [];
function interaction(values) {
  const channel = { id: '5', toString: () => '#roles', send: async (payload) => { const message = { id: `90${posted.length}`, url: 'https://discord.com/channels/1/5/90', channel, delete: async () => { deleted.push(message.id); } }; posted.push({ payload, message }); return message; } };
  return {
    guild: { id: '1' }, channel, user: { id: '2' }, member: {},
    options: { getSubcommand: () => 'add', getString: (key) => values[key] ?? null, getRole: () => ({ id: '77', toString: () => '@Member' }), getChannel: () => null },
    deferReply: async () => {},
    editReply: async (payload) => { replies.push(JSON.stringify(payload.components[0].toJSON())); },
  };
}
const last = () => replies[replies.length - 1];

(async () => {
  await command.execute(interaction({ message_id: 'new', emoji: '🎀', embed: 'roles' }));
  assert.equal(posted.length, 1, 'the saved embed is posted');
  assert.deepEqual(posted[0].payload.embeds, [{ title: 'Roles' }]);
  assert.deepEqual(posted[0].payload.allowedMentions, { parse: [] }, 'nobody is pinged by the message');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].message_id, '900'); assert.equal(bindings[0].interaction_type, 'button', 'a new message always gets a button');
  assert.deepEqual(synced, [{ id: '900', rows: 1 }], 'the button is put on the message');
  assert.match(last(), /Button role now grants/); assert.match(last(), /discord\.com\/channels\/1\/5\/90/);

  // Without the embed, with an embed that does not exist, and with a V2 design.
  await command.execute(interaction({ message_id: 'NEW', emoji: '🎀' }));
  assert.match(last(), /write the saved embed/); assert.equal(posted.length, 1);
  await command.execute(interaction({ message_id: 'new', emoji: '🎀', embed: 'missing' }));
  assert.match(last(), /does not exist or it is empty/); assert.equal(posted.length, 1);
  template = { content: '', embeds: [], components: [], flags: 32768 };
  await command.execute(interaction({ message_id: 'new', emoji: '🎀', embed: 'roles' }));
  assert.match(last(), /V2 design cannot hold role buttons/); assert.equal(posted.length, 1, 'a V2 design is not posted');
  template = { content: 'Pick', embeds: [{ title: 'Roles' }], components: [] };

  // When saving fails, the message that was just posted is taken down.
  failSave = true;
  await command.execute(interaction({ message_id: 'new', emoji: '🎀', embed: 'roles' }));
  assert.equal(posted.length, 2); assert.deepEqual(deleted, ['901'], 'the message made for this is deleted');
  assert.match(last(), /database down/);
  failSave = false;
  console.log('Checked !reactionrole add new with a saved embed.');
})().catch((err) => { console.error(err); process.exit(1); });
