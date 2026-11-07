// `autoresponder exclusive <channel or role> <trigger>`: one switch over the lists of channels and roles of an autoresponder.
process.env.DISCORD_TOKEN ||= 'check-only';
const assert = require('node:assert/strict');
const path = require('node:path');
const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel));
const stub = (rel, exports) => { require.cache[resolve(rel)] = { id: resolve(rel), filename: resolve(rel), loaded: true, exports }; };

const store = new Map([['hello', { id: 'ar1', trigger: 'hello', channel_ids: [], role_ids: [] }]]);
stub('src/db/autoResponders.js', {
  MAX_PER_GUILD: 25, limitFor: async () => 25, listForGuild: async () => [...store.values()], listForGuildCached: async () => [...store.values()], invalidateGuildCache: () => {},
  getById: async (_g, id) => [...store.values()].find((r) => r.id === id) ?? null,
  getByTrigger: async (_g, trigger) => store.get(trigger) ?? null,
  create: async () => null, remove: async () => null, removeAllForGuild: async () => null, removeByTrigger: async () => false,
  update: async (_g, id, patch) => { const ar = [...store.values()].find((r) => r.id === id); Object.assign(ar, patch); return ar; },
});
stub('src/config.js', { verifyTokenSecret: 'a-secret-for-the-check-of-the-autoresponder' });
stub('src/utils/logger.js', { warn() {}, info() {}, error() {}, debug() {} });
stub('src/db/guilds.js', { ensureGuild: async () => null });
stub('src/db/embedTemplates.js', { getTemplate: async () => null });
stub('src/utils/embedCodeMessage.js', { payloadFromCode: async () => ({ payload: null }) });
const command = require('../src/commands/automation/autoresponder.js');

const guild = {
  id: '1',
  channels: { cache: new Map([['300000000000000001', { id: '300000000000000001', name: 'music' }], ['301000000000000001', { id: '301000000000000001', name: 'general' }]]) },
  roles: { cache: new Map([['400000000000000001', { id: '400000000000000001', name: 'vip', managed: false }]]) },
};
guild.channels.cache.find = (fn) => [...guild.channels.cache.values()].find(fn);
guild.roles.cache.find = (fn) => [...guild.roles.cache.values()].find(fn);
const run = async (target, trigger) => {
  let reply = null;
  const interaction = {
    guild, user: { id: '9' }, client: {},
    options: { getSubcommandGroup: () => null, getSubcommand: () => 'exclusive', getString: (name) => ({ target, trigger })[name] },
    deferReply: async () => {}, editReply: async (payload) => { reply = JSON.stringify(payload.components.map((c) => c.toJSON())); }, reply: async () => {},
  };
  await command.execute(interaction);
  return reply;
};

(async () => {
  let reply = await run('<#300000000000000001>', 'hello');
  assert.deepEqual(store.get('hello').channel_ids, ['300000000000000001'], 'the first time the channel goes in');
  assert.ok(reply.includes('<#300000000000000001>'), 'it says where it answers');
  reply = await run('music', 'hello');
  assert.deepEqual(store.get('hello').channel_ids, [], 'the second time (by name) it comes out');
  reply = await run('400000000000000001', 'hello');
  assert.deepEqual(store.get('hello').role_ids, ['400000000000000001'], 'a role goes into the roles it answers to');
  assert.ok(reply.includes('<@&400000000000000001>'));
  await run('vip', 'hello');
  assert.deepEqual(store.get('hello').role_ids, [], 'and comes out');
  reply = await run('nothing-like-this', 'hello');
  assert.ok(/not a channel or a role/i.test(reply), 'a target that is not in the server is refused');
  assert.deepEqual(store.get('hello').channel_ids, []);
  reply = await run('<#300000000000000001>', 'missing');
  assert.ok(/No autoresponder with trigger/.test(reply), 'a trigger that does not exist is said so');
  const sub = command.data.toJSON().options.find((option) => option.name === 'exclusive');
  assert.deepEqual(sub.options.map((option) => option.name), ['target', 'trigger'], 'the options');
  console.log('Autoresponder exclusive checks passed.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
