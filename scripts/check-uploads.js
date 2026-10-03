// Checks the upload module: which messages count, the welcome and role of a first upload, the numbers and the commands.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/config.js', { ownerId: 'owner', developerIds: [] });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO' } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
const templates = new Map();
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => templates.get(`${guildId}:${name}`) ?? null });
stub('src/utils/templatedMessage.js', { templatePayload: async (guildId, name) => (templates.has(`${guildId}:${name}`) ? { content: undefined, embeds: [{ title: name }], components: [], files: [] } : null) });
let premiumActive = false;
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: premiumActive }), getGuildLimits: (premium) => ({ uploadChannels: premium?.active ? 100 : 20 }) });
let config = null;
let log = [];
let nextId = 1;
const DEFAULTS = { enabled: false, channel_ids: [], uploader_role_id: null, welcome: {} };
stub('src/db/uploads.js', {
  DEFAULTS,
  getConfig: async () => config,
  getConfigCached: async () => config,
  upsertConfig: async (guildId, changes) => { config = { ...(config ?? DEFAULTS), ...changes }; return config; },
  hasUploaded: async (guildId, userId) => log.some((row) => row.user_id === userId),
  addLog: async (row) => { const saved = { id: nextId++, guild_id: row.guildId, user_id: row.userId, channel_id: row.channelId, files: row.files, created_at: new Date().toISOString() }; log.push(saved); return saved; },
  listLog: async (guildId, { since = null, userId = null } = {}) => log.filter((row) => (!since || new Date(row.created_at) >= since) && (!userId || row.user_id === userId)).slice().reverse(),
});

const event = require('../src/events/messageCreateUploads');
const uploads = require('../src/commands/automation/uploads');
const uploadConfig = require('../src/commands/automation/uploadconfig');

const fakeUser = (id, username, bot = false) => ({ id, username, bot, tag: username, globalName: username, displayName: username, createdTimestamp: 1_700_000_000_000, displayAvatarURL: () => 'https://cdn.example/a.png', bannerURL: () => null, toString: () => `<@${id}>` });
const fakeGuild = (over = {}) => ({ id: 'g1', name: 'Mine', ownerId: 'owner', memberCount: 100, premiumTier: 0, premiumSubscriptionCount: 0, createdTimestamp: 1_600_000_000_000, iconURL: () => 'https://cdn.example/g.png', bannerURL: () => null, splashURL: () => null, members: { cache: new Collection(), me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } } }, channels: { cache: new Collection() }, roles: { cache: new Collection([['up', { id: 'up', position: 3, managed: false }], ['high', { id: 'high', position: 30, managed: false }]]) }, emojis: { cache: new Collection() }, stickers: { cache: new Collection() }, ...over });

(async () => {
  const sent = [];
  const given = [];
  const post = (over = {}) => {
    const member = { id: 'u1', user: fakeUser('u1', 'Mia'), displayName: 'Mia', displayAvatarURL: () => 'https://cdn.example/a.png', joinedTimestamp: 1, roles: { cache: new Collection(), add: async (role) => { given.push(role.id); } } };
    return { id: `m${nextId}`, author: fakeUser('u1', 'Mia'), member, guild: fakeGuild(), channel: { id: 'up-chan', send: async (payload) => { sent.push(payload); } }, attachments: new Collection([['a', {}]]), ...over };
  };
  const run = async (message) => { sent.length = 0; given.length = 0; await event.execute(message); };

  await run(post()); assert.equal(log.length, 0, 'nothing is counted while the module is off');
  config = { enabled: true, channel_ids: ['up-chan'], uploader_role_id: 'up', welcome: {} };
  await run(post({ channel: { id: 'other', send: async () => {} } })); assert.equal(log.length, 0, 'only upload channels count');
  await run(post({ attachments: new Collection() })); assert.equal(log.length, 0, 'a message without files does not count');
  await run(post({ author: fakeUser('b', 'Bot', true) })); assert.equal(log.length, 0, 'bots do not count');

  await run(post({ attachments: new Collection([['a', {}], ['b', {}]]) }));
  assert.equal(log.length, 1); assert.equal(log[0].files, 2, 'a message counts once, with its files'); assert.deepEqual(given, ['up'], 'the first upload gives the role');
  assert.match(sent[0].content, /Thanks for your first upload, <@u1>/); assert.deepEqual(sent[0].allowedMentions, { users: ['u1'] });
  await run(post()); assert.equal(log.length, 2); assert.deepEqual(given, [], 'the second does not give it again'); assert.equal(sent.length, 0, 'or welcome again');

  log = []; config.welcome = { text: 'Hi {user.mention}, welcome to {guild.name}' };
  await run(post()); assert.equal(sent[0].content, 'Hi <@u1>, welcome to Mine');
  log = []; templates.set('g1:card', { data: {} }); config.welcome = { template: 'card' };
  await run(post()); assert.deepEqual(sent[0].embeds, [{ title: 'card' }]);
  log = []; config.uploader_role_id = 'high';
  await run(post()); assert.deepEqual(given, [], 'a role above the bot is never given'); assert.equal(sent.length, 1, 'the welcome still goes');
  log = []; config.welcome = {};

  // The numbers.
  const now = new Date();
  log = [
    { id: 1, user_id: 'a', channel_id: 'c1', files: 3, created_at: now.toISOString() },
    { id: 2, user_id: 'a', channel_id: 'c1', files: 1, created_at: now.toISOString() },
    { id: 3, user_id: 'b', channel_id: 'c1', files: 1, created_at: new Date(Date.now() - 60 * 86400000).toISOString() },
  ];
  const talk = async (command, sub, values = {}) => {
    const out = [];
    const pick = (name) => (name in values ? values[name] : null);
    const interaction = { guild: fakeGuild(), user: fakeUser('a', 'Ann'), options: { getSubcommand: () => sub, getString: pick, getBoolean: pick, getRole: pick, getChannel: pick, getUser: pick }, deferReply: async () => {}, editReply: async (payload) => { out.push(payload.components[0].text); } };
    await command.execute(interaction);
    return out.join('\n');
  };
  assert.match(await talk(uploads, 'stats'), /Total: \*\*2\*\* \(4 files\)/);
  const board = await talk(uploads, 'leaderboard', { period: 'all' });
  assert.match(board, /1\. <@a>  \*\*2\*\*[\s\S]*2\. <@b>  \*\*1\*\*/);
  assert.doesNotMatch(await talk(uploads, 'leaderboard', { period: 'week' }), /<@b>/); assert.match(await talk(uploads, 'leaderboard', { period: 'today' }), /Today/); assert.match(await talk(uploads, 'leaderboard', { period: 'x' }), /Choose/);
  config.enabled = false; assert.match(await talk(uploads, 'stats'), /not turned on/); config.enabled = true;

  // The settings.
  config = null;
  assert.match(await talk(uploadConfig, 'enable', { enabled: true }), /Add a channel/);
  for (let index = 1; index <= 20; index += 1) await talk(uploadConfig, 'addchannel', { channel: { id: `c${index}`, toString: () => `#c${index}` } });
  assert.equal(config.channel_ids.length, 20);
  assert.match(await talk(uploadConfig, 'addchannel', { channel: { id: 'c21', toString: () => '#c21' } }), /already has 20 upload channels\. Premium raises it to 100/);
  premiumActive = true; assert.match(await talk(uploadConfig, 'addchannel', { channel: { id: 'c21', toString: () => '#c21' } }), /is now an upload channel/); premiumActive = false;
  assert.match(await talk(uploadConfig, 'removechannel', { channel: { id: 'c21', toString: () => '#c21' } }), /not an upload channel anymore/);
  assert.match(await talk(uploadConfig, 'role', { role: { id: 'up', toString: () => '@Uploader' } }), /@Uploader is given/); assert.equal(config.uploader_role_id, 'up');
  assert.match(await talk(uploadConfig, 'welcome', { text: 'Yay {user.mention}' }), /Welcome saved/); assert.equal(config.welcome.text, 'Yay {user.mention}');
  assert.match(await talk(uploadConfig, 'welcome', { template: 'nope' }), /no saved embed/);
  templates.set('g1:card', { data: {} }); await talk(uploadConfig, 'welcome', { template: 'card' }); assert.equal(config.welcome.template, 'card');
  await talk(uploadConfig, 'welcome', { text: 'reset', template: 'none' }); assert.deepEqual(config.welcome, {}, 'reset and none go back to the default');
  assert.match(await talk(uploadConfig, 'view'), /Uploads[\s\S]*Uploader role: <@&up>/);
  assert.equal(uploads.prefixOnly, true); assert.equal(uploadConfig.prefixOnly, true);
  console.log('Checked the uploads: what counts, the first upload, the numbers and the commands.');
})().catch((error) => { console.error(error); process.exit(1); });
